using System.Text.Json;
using Formbase.Core.Schema;

namespace Lowline.Host.Tests;

public sealed class VaultProjectionTests
{
    private static readonly TemplateSnapshot BugReport = new("bug-report@1",
    [
        new TemplateField("제목", "text"),
        new TemplateField("심각도", "select"),
        new TemplateField("재현됨", "checkbox"),
        new TemplateField("태그", "checkbox", Multiple: true),
        new TemplateField("점수", "number"),
    ]);

    private static DocumentSnapshot Document(string path, string json) =>
        new(path, "bug-report@1", JsonSerializer.Deserialize<Dictionary<string, JsonElement>>(json)!);

    private static CancellationToken Ct => TestContext.Current.CancellationToken;

    [Fact]
    public async Task Projects_one_row_per_document_with_korean_columns()
    {
        await using var vault = new VaultProjection();
        var result = await vault.IngestAsync(new VaultSnapshot([BugReport],
        [
            Document("문서/b.md", """{"제목": "저장 후 멈춤", "심각도": "높음", "재현됨": true, "태그": ["UI"], "점수": 3}"""),
            Document("문서/a.md", """{"제목": "열기 실패", "재현됨": false}"""),
        ]), Ct);

        Assert.Equal(2, result.Appended);
        Assert.Equal(["bug-report@1"], result.Projections);
        Assert.Empty(result.Skipped);
        Assert.True(vault.Indexed);

        var table = await vault.TableAsync("bug-report@1", Ct);
        Assert.NotNull(table);
        Assert.Equal(["제목", "심각도", "재현됨", "태그", "점수"], table.Columns.Select(c => c.Name));
        Assert.Equal(["문서/a.md", "문서/b.md"], table.Rows.Select(r => r.Path));
        var b = table.Rows[1].Values;
        Assert.Equal("저장 후 멈춤", b["제목"]);
        Assert.Equal("높음", b["심각도"]);
        Assert.Equal(true, b["재현됨"]);
        Assert.Equal(3m, Convert.ToDecimal(b["점수"]));
        Assert.Null(table.Rows[0].Values["심각도"]);
    }

    [Fact]
    public async Task Answers_the_rows_that_match_every_filter()
    {
        await using var vault = new VaultProjection();
        await vault.IngestAsync(new VaultSnapshot([BugReport],
        [
            Document("문서/2026-01-15 저장 멈춤.md", """{"제목": "저장 후 멈춤", "심각도": "높음"}"""),
            Document("문서/2026-01-16 열기 실패.md", """{"제목": "열기 실패", "심각도": "높음"}"""),
            Document("문서/2026-02-01 저장 느림.md", """{"제목": "저장이 느림", "심각도": "낮음"}"""),
        ]), Ct);

        async Task<string[]> Paths(params ColumnFilter[] filters) =>
            [.. (await vault.TableAsync("bug-report@1", filters, Ct))!.Rows.Select(r => r.Path)];

        Assert.Equal(["문서/2026-01-15 저장 멈춤.md", "문서/2026-02-01 저장 느림.md"], await Paths(new ColumnFilter("제목", "contains", "저장")));
        Assert.Equal(["문서/2026-01-15 저장 멈춤.md", "문서/2026-01-16 열기 실패.md"], await Paths(new ColumnFilter("심각도", "equal", "높음")));
        Assert.Equal(["문서/2026-01-15 저장 멈춤.md"],
            await Paths(new ColumnFilter("제목", "contains", "저장"), new ColumnFilter("심각도", "equal", "높음")));
        // A document's name is its path.
        Assert.Equal(["문서/2026-02-01 저장 느림.md"], await Paths(new ColumnFilter(VaultProjection.PathColumn, "contains", "2026-02")));
        Assert.Empty(await Paths(new ColumnFilter("제목", "contains", "없는 말")));
        await vault.IngestAsync(new VaultSnapshot([BugReport],
        [
            Document("문서/1.md", """{"제목": "하나", "점수": 1}"""),
            Document("문서/2.md", """{"제목": "둘", "점수": 2.5}"""),
            Document("문서/3.md", """{"제목": "셋", "점수": 3}"""),
            Document("문서/4.md", """{"제목": "없음"}"""),
        ]), Ct);
        // A number field's bounds, both included; a document without a value is outside any.
        Assert.Equal(["문서/2.md", "문서/3.md"], await Paths(new ColumnFilter("점수", "atLeast", "2")));
        Assert.Equal(["문서/1.md", "문서/2.md"],
            await Paths(new ColumnFilter("점수", "atLeast", "1"), new ColumnFilter("점수", "atMost", "2.5")));
        await Assert.ThrowsAsync<ArgumentException>(() => Paths(new ColumnFilter("제목", "near", "저장")));
    }

    [Fact]
    public async Task A_new_snapshot_replaces_the_old_one()
    {
        await using var vault = new VaultProjection();
        await vault.IngestAsync(new VaultSnapshot([BugReport], [Document("문서/a.md", """{"제목": "첫 값"}""")]), Ct);
        await vault.IngestAsync(new VaultSnapshot([BugReport], [Document("문서/a.md", """{"제목": "고친 값"}""")]), Ct);

        var table = await vault.TableAsync("bug-report@1", Ct);
        var row = Assert.Single(table!.Rows);
        Assert.Equal("고친 값", row.Values["제목"]);
    }

    [Fact]
    public async Task Documents_of_a_template_missing_from_the_vault_are_reported()
    {
        await using var vault = new VaultProjection();
        var result = await vault.IngestAsync(new VaultSnapshot([BugReport],
            [new DocumentSnapshot("문서/x.md", "gone@1", new Dictionary<string, JsonElement>())]), Ct);

        Assert.Equal(0, result.Appended);
        var skipped = Assert.Single(result.Skipped);
        Assert.Equal("문서/x.md", skipped.Path);
    }

    [Fact]
    public async Task Date_fields_are_dates_the_same_on_every_computer_and_an_unreadable_one_empties_only_its_field()
    {
        var visits = new TemplateSnapshot("visit@1",
        [
            new TemplateField("제목", "text"),
            new TemplateField("방문일", "date"),
            new TemplateField("예약", "datetime-local"),
        ]);
        static DocumentSnapshot Visit(string path, string json) =>
            new(path, "visit@1", JsonSerializer.Deserialize<Dictionary<string, JsonElement>>(json)!);

        await using var vault = new VaultProjection();
        var result = await vault.IngestAsync(new VaultSnapshot([visits],
        [
            Visit("문서/1.md", """{"제목": "하나", "방문일": "2026-01-15", "예약": "2026-01-15T09:30"}"""),
            Visit("문서/2.md", """{"제목": "둘", "방문일": "2026-01-31"}"""),
            Visit("문서/3.md", """{"제목": "셋", "방문일": "2026-02-01"}"""),
            Visit("문서/4.md", """{"제목": "넷", "방문일": "다음 주쯤"}"""),
        ]), Ct);

        // The document with an unreadable date is still a row; only that field is empty, and it is said where.
        Assert.Empty(result.Skipped);
        var skip = Assert.Single(result.SkippedFields);
        Assert.Equal(("문서/4.md", "방문일"), (skip.Path, skip.Field));

        var table = await vault.TableAsync("visit@1", Ct);
        Assert.Equal(["문서/1.md", "문서/2.md", "문서/3.md", "문서/4.md"], table!.Rows.Select(r => r.Path));
        // A date reads back as it was written, whatever the computer's time zone.
        Assert.Equal("2026-01-15", table.Rows[0].Values["방문일"]);
        Assert.Equal("2026-01-15T09:30", table.Rows[0].Values["예약"]);
        Assert.Null(table.Rows[3].Values["방문일"]);

        async Task<string[]> Paths(params ColumnFilter[] filters) =>
            [.. (await vault.TableAsync("visit@1", filters, Ct))!.Rows.Select(r => r.Path)];
        // A date range, both ends included, matches dates — not the order of their text.
        Assert.Equal(["문서/2.md", "문서/3.md"], await Paths(new ColumnFilter("방문일", "atLeast", "2026-01-16")));
        Assert.Equal(["문서/1.md", "문서/2.md"], await Paths(new ColumnFilter("방문일", "atMost", "2026-01-31")));
    }

    [Fact]
    public async Task An_unreadable_number_empties_only_its_field_and_is_said_where()
    {
        var orders = new TemplateSnapshot("order@1", [new TemplateField("제목", "text"), new TemplateField("수량", "number")]);
        static DocumentSnapshot Order(string path, string json) =>
            new(path, "order@1", JsonSerializer.Deserialize<Dictionary<string, JsonElement>>(json)!);

        await using var vault = new VaultProjection();
        var result = await vault.IngestAsync(new VaultSnapshot([orders],
        [
            Order("문서/1.md", """{"제목": "하나", "수량": 12.5}"""),
            Order("문서/2.md", """{"제목": "둘", "수량": "1,000"}"""),
        ]), Ct);

        Assert.Empty(result.Skipped);
        var skip = Assert.Single(result.SkippedFields);
        Assert.Equal(("문서/2.md", "수량"), (skip.Path, skip.Field));
        var table = await vault.TableAsync("order@1", Ct);
        Assert.Equal(["문서/1.md", "문서/2.md"], table!.Rows.Select(r => r.Path));
        Assert.Null(table.Rows[1].Values["수량"]);
    }

    [Fact]
    public async Task A_cache_that_held_dates_as_text_shows_them_as_dates_once_the_field_is_a_date()
    {
        // A cache filled before date fields were dates holds them as text: the same template, its field now a
        // date, rebuilds the table rather than comparing text.
        static TemplateSnapshot Visits(string type) => new("visit@1", [new TemplateField("방문일", type)]);
        var documents = new[]
        {
            new DocumentSnapshot("문서/1.md", "visit@1", new Dictionary<string, JsonElement> { ["방문일"] = JsonSerializer.SerializeToElement("2026-1-9") }),
            new DocumentSnapshot("문서/2.md", "visit@1", new Dictionary<string, JsonElement> { ["방문일"] = JsonSerializer.SerializeToElement("2026-01-10") }),
        };
        await using var vault = new VaultProjection();
        await vault.IngestAsync(new VaultSnapshot([Visits("text")], documents), Ct);

        var result = await vault.IngestAsync(new VaultSnapshot([Visits("date")], documents), Ct);
        Assert.Equal(["visit@1"], result.Projections);
        // As text, "2026-1-9" sorts after "2026-01-10"; as dates it is the day before.
        var table = await vault.TableAsync("visit@1", [new ColumnFilter("방문일", "atLeast", "2026-01-10")], Ct);
        Assert.Equal(["문서/2.md"], table!.Rows.Select(r => r.Path));
        Assert.Equal("2026-01-10", table.Rows[0].Values["방문일"]);
    }

    [Fact]
    public async Task An_unknown_template_has_no_table()
    {
        await using var vault = new VaultProjection();
        Assert.Null(await vault.TableAsync("bug-report@1", Ct));
        await vault.IngestAsync(new VaultSnapshot([BugReport], []), Ct);
        Assert.Null(await vault.TableAsync("other@1", Ct));
        Assert.Empty((await vault.TableAsync("bug-report@1", Ct))!.Rows);
    }

    [Theory]
    [InlineData("text", false, ColumnType.Text)]
    [InlineData("select", false, ColumnType.Text)]
    [InlineData("radio", false, ColumnType.Text)]
    [InlineData("textarea", false, ColumnType.Text)]
    [InlineData("date", false, ColumnType.Timestamp)]
    [InlineData("datetime-local", false, ColumnType.Timestamp)]
    [InlineData("month", false, ColumnType.Text)]
    [InlineData("time", false, ColumnType.Text)]
    [InlineData("checkbox", false, ColumnType.Boolean)]
    [InlineData("checkbox", true, ColumnType.Jsonb)]
    [InlineData("number", false, ColumnType.Decimal)]
    [InlineData("range", false, ColumnType.Decimal)]
    public void Maps_formdown_field_types_to_column_types(string type, bool multiple, ColumnType expected) =>
        Assert.Equal(expected, VaultProjection.ColumnTypeOf(new TemplateField("f", type, multiple)));
}
