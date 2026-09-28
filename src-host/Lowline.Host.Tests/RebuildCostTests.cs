using System.Diagnostics;
using System.Text.Json;

namespace Lowline.Host.Tests;

/// <summary>
/// What a rebuild from the vault costs at 1,000 and 10,000 documents. Every outside edit rebuilds
/// the whole snapshot until records can be corrected in place, so this is the price of one edit.
/// Runs only with <c>LOWLINE_PERF=1</c>; writes its figures to <c>LOWLINE_PERF_OUT</c> when set.
/// </summary>
public sealed class RebuildCostTests
{
    private static readonly TemplateSnapshot Intake = new("intake@1",
    [
        new TemplateField("요청", "textarea"),
        new TemplateField("부서", "text"),
        new TemplateField("담당", "select"),
        new TemplateField("긴급", "checkbox"),
    ], Suggest: ["담당"]);

    private static readonly string[] Things = ["노트북", "모니터", "급여 명세서", "휴가 신청", "출입 카드", "프린터", "메일 계정", "법인 카드", "교육 일정", "의자"];
    private static readonly string[] Troubles = ["이 고장났어요", "을 다시 받고 싶어요", "이 안 돼요", "을 바꾸고 싶어요", "문의드립니다", "이 느려요"];
    private static readonly string[] Departments = ["영업", "개발", "인사", "재무", "운영"];
    private static readonly string[] Owners = ["장비", "인사", "재무", "총무"];

    private static CancellationToken Ct => TestContext.Current.CancellationToken;

    private static VaultSnapshot Synthetic(int count)
    {
        var random = new Random(count);
        var start = new DateTimeOffset(2025, 1, 1, 0, 0, 0, TimeSpan.Zero);
        var documents = new List<DocumentSnapshot>(count);
        var events = new List<SuggestionEvent>();
        for (var i = 0; i < count; i++)
        {
            var thing = random.Next(Things.Length);
            var values = new Dictionary<string, object>
            {
                ["요청"] = $"{Things[thing]}{Troubles[random.Next(Troubles.Length)]} ({i})",
                ["부서"] = Departments[random.Next(Departments.Length)],
                ["담당"] = Owners[thing % Owners.Length],
                ["긴급"] = random.Next(5) == 0,
            };
            var json = JsonSerializer.Deserialize<Dictionary<string, JsonElement>>(JsonSerializer.Serialize(values))!;
            var path = $"문서/{i:D6}.md";
            var at = start.AddMinutes(i * 37);
            documents.Add(new DocumentSnapshot(path, "intake@1", json, at.ToUnixTimeMilliseconds()));
            if (i % 2 == 0)
                events.Add(new SuggestionEvent(at.ToString("O"), path, "담당", random.Next(4) == 0 ? "correct" : "accept", Owners[thing % Owners.Length], "intake@1"));
        }
        return new VaultSnapshot([Intake], documents, events);
    }

    [Theory]
    [InlineData(1_000)]
    [InlineData(10_000)]
    public async Task Measures_a_full_rebuild(int count)
    {
        Assert.SkipUnless(Environment.GetEnvironmentVariable("LOWLINE_PERF") == "1", "set LOWLINE_PERF=1 to measure");
        var snapshot = Synthetic(count);
        var vault = new VaultProjection();

        // The first ingest pays for loading the embedder and warming the runtime; the second is what
        // each later outside edit costs.
        var first = Stopwatch.StartNew();
        await vault.IngestAsync(snapshot, Ct);
        first.Stop();
        var again = Stopwatch.StartNew();
        var result = await vault.IngestAsync(snapshot, Ct);
        again.Stop();
        Assert.Equal(count, result.Ingested);

        var table = Stopwatch.StartNew();
        var rows = (await vault.TableAsync("intake@1", Ct))!.Rows.Count;
        table.Stop();
        Assert.Equal(count, rows);

        var request = new SuggestRequest("intake@1", "담당",
            JsonSerializer.Deserialize<Dictionary<string, JsonElement>>("""{"요청": "노트북이 고장났어요", "부서": "영업"}""")!);
        var suggest = Stopwatch.StartNew();
        var suggestion = await vault.SuggestAsync(request, Ct);
        suggest.Stop();
        Assert.NotNull(suggestion);

        var curves = Stopwatch.StartNew();
        await vault.CurvesAsync(Ct);
        curves.Stop();

        var line = $"{count} docs · first ingest {first.ElapsedMilliseconds} ms · rebuild {again.ElapsedMilliseconds} ms · "
            + $"table {table.ElapsedMilliseconds} ms · suggest {suggest.ElapsedMilliseconds} ms · curves {curves.ElapsedMilliseconds} ms · "
            + $"managed heap {GC.GetTotalMemory(forceFullCollection: true) / (1024 * 1024)} MB";
        TestContext.Current.TestOutputHelper?.WriteLine(line);
        if (Environment.GetEnvironmentVariable("LOWLINE_PERF_OUT") is { Length: > 0 } output)
            await File.AppendAllTextAsync(output, line + Environment.NewLine, Ct);
    }
}
