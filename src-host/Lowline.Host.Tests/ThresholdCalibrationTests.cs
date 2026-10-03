using System.Text.Json;

namespace Lowline.Host.Tests;

/// <summary>
/// Whether the key layer keeps the precision its threshold replay promises, as the app uses it: documents
/// asked about in turn, each then confirmed and remembered, the thresholds chosen again as the confirmed
/// grow by a tenth. Runs only with <c>LOWLINE_PERF=1</c>; writes its figures to <c>LOWLINE_PERF_OUT</c> when
/// set.
/// </summary>
public sealed class ThresholdCalibrationTests
{
    private static readonly TemplateSnapshot Routing = new("routing@1",
    [
        new TemplateField("부서", "select"),
        new TemplateField("유형", "select"),
        new TemplateField("담당", "select"),
    ], Suggest: ["담당"]);

    /// <summary>
    /// Requests whose owner two chosen fields each say something about: mostly the kind of request, sometimes
    /// the department asking, now and then someone else. Each field is a key of the key layer, so this is
    /// where keys agreeing with each other shows.
    /// </summary>
    private static VaultSnapshot Routed(int count, int seed)
    {
        string[] departments = ["영업", "개발", "생산", "지원"];
        string[] kinds = ["장비", "급여", "정산", "출입"];
        string[] owners = ["장비팀", "인사팀", "재무팀", "총무팀"];
        var random = new Random(seed);
        var documents = new List<DocumentSnapshot>(count);
        var start = new DateTimeOffset(2025, 1, 1, 0, 0, 0, TimeSpan.Zero);
        for (var i = 0; i < count; i++)
        {
            var department = random.Next(departments.Length);
            var kind = random.Next(kinds.Length);
            var roll = random.NextDouble();
            var owner = roll < 0.7 ? owners[kind] : roll < 0.9 ? owners[department] : owners[random.Next(owners.Length)];
            var json = JsonSerializer.Deserialize<Dictionary<string, JsonElement>>(JsonSerializer.Serialize(
                new Dictionary<string, object> { ["부서"] = departments[department], ["유형"] = kinds[kind], ["담당"] = owner }))!;
            documents.Add(new DocumentSnapshot($"문서/{i:D6}.md", "routing@1", json, start.AddMinutes(i * 37).ToUnixTimeMilliseconds()));
        }
        return new VaultSnapshot([Routing], documents, []);
    }

    [Theory]
    [InlineData(50, 300)]
    [InlineData(300, 300)]
    public async Task Measures_the_key_layer_over_two_keys(int confirmed, int asked)
    {
        Assert.SkipUnless(Environment.GetEnvironmentVariable("LOWLINE_PERF") == "1", "set LOWLINE_PERF=1 to measure");
        var ct = TestContext.Current.CancellationToken;
        var all = Routed(confirmed + asked, seed: confirmed);
        await using var vault = new VaultProjection();
        await vault.IngestAsync(new VaultSnapshot(all.Templates, [.. all.Documents.Take(confirmed)]), ct);
        await vault.ThresholdsSelected.WaitAsync(ct);
        var replay = (await vault.CurvesAsync(ct)).Single();

        // As the app goes: each document asked about is then confirmed and remembered, and the thresholds are
        // chosen again as the confirmed grow by a tenth — so what is asked meets the history as it is by then.
        int right = 0, wrong = 0, abstained = 0;
        var promised = new List<double>();
        for (var i = confirmed; i < all.Documents.Count; i++)
        {
            var document = all.Documents[i];
            var values = document.Values.Where(v => v.Key != "담당").ToDictionary(v => v.Key, v => v.Value);
            var suggestion = (await vault.SuggestAsync(new SuggestRequest("routing@1", "담당", values), ct))!;
            if (suggestion.Value is null) abstained++;
            else
            {
                if (suggestion.Value == document.Values["담당"].GetString()) right++;
                else wrong++;
                if ((await vault.CurvesAsync(ct)).Single().Replay?.Precision is { } precision) promised.Add(precision);
            }
            await vault.IngestAsync(new VaultSnapshot(all.Templates, [.. all.Documents.Take(i + 1)]), ct);
            await vault.ThresholdsSelected.WaitAsync(ct);
        }

        await Measurement.ReportAsync(
            $"two keys · {confirmed} confirmed · {asked} asked · {replay.WhyNoReplay ?? "replay"} threshold {replay.Replay?.Threshold:F4} precision {replay.Replay?.Precision:P0} answered {replay.Replay?.AnswerRate:P0}"
            + $" · asked and confirmed in turn: right {right} wrong {wrong} abstained {abstained}"
            + $" ({(right + wrong == 0 ? 0 : 100.0 * right / (right + wrong)):F0}% right, promised {(promised.Count == 0 ? 0 : 100 * promised.Average()):F0}%)", ct);
    }
}
