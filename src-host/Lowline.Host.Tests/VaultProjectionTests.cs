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
    [InlineData("date", false, ColumnType.Text)]
    [InlineData("checkbox", false, ColumnType.Boolean)]
    [InlineData("checkbox", true, ColumnType.Jsonb)]
    [InlineData("number", false, ColumnType.Decimal)]
    [InlineData("range", false, ColumnType.Decimal)]
    public void Maps_formdown_field_types_to_column_types(string type, bool multiple, ColumnType expected) =>
        Assert.Equal(expected, VaultProjection.ColumnTypeOf(new TemplateField("f", type, multiple)));
}
