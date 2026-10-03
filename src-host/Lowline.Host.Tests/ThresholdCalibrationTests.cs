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

    private static readonly TemplateSnapshot Approved = new("approved@1",
    [
        new TemplateField("부서", "select"),
        new TemplateField("유형", "select"),
        new TemplateField("담당", "select"),
        new TemplateField("승인", "select"),
    ], Suggest: ["담당", "승인"]);

    /// <summary>
    /// The requests of <see cref="Routed"/>, each also approved by someone who mostly goes with its owner: one judged
    /// field that the other, once confirmed, says the most about.
    /// </summary>
    private static VaultSnapshot RoutedAndApproved(int count, int seed)
    {
        string[] approvers = ["장비 승인", "인사 승인", "재무 승인", "총무 승인"];
        var routed = Routed(count, seed);
        var random = new Random(seed + 1);
        var documents = routed.Documents.Select(d =>
        {
            var owner = Array.IndexOf(["장비팀", "인사팀", "재무팀", "총무팀"], d.Values["담당"].GetString());
            var approver = random.NextDouble() < 0.85 ? approvers[owner] : approvers[random.Next(approvers.Length)];
            var values = new Dictionary<string, JsonElement>(d.Values)
            {
                ["승인"] = JsonSerializer.SerializeToElement(approver),
            };
            return d with { Template = "approved@1", Values = values };
        });
        return new VaultSnapshot([Approved], [.. documents], []);
    }

    /// <summary>
    /// Both judged fields asked about as the form is filled in: the owner from the observed fields, the approver once
    /// the owner is confirmed — the order the threshold replay takes when a document does not say which came first.
    /// </summary>
    [Theory]
    [InlineData(50, 300)]
    [InlineData(300, 300)]
    public async Task Measures_a_judged_field_resting_on_another(int confirmed, int asked)
    {
        Assert.SkipUnless(Environment.GetEnvironmentVariable("LOWLINE_PERF") == "1", "set LOWLINE_PERF=1 to measure");
        var ct = TestContext.Current.CancellationToken;
        var all = RoutedAndApproved(confirmed + asked, seed: confirmed);
        await using var vault = new VaultProjection();
        await vault.IngestAsync(new VaultSnapshot(all.Templates, [.. all.Documents.Take(confirmed)]), ct);
        await vault.ThresholdsSelected.WaitAsync(ct);

        var tally = new Dictionary<string, (int Right, int Wrong, int Abstained, List<double> Promised)>
        {
            ["담당"] = (0, 0, 0, []),
            ["승인"] = (0, 0, 0, []),
        };
        for (var i = confirmed; i < all.Documents.Count; i++)
        {
            var document = all.Documents[i];
            foreach (var field in (string[])["담당", "승인"])
            {
                // What is filled in by the time the field is asked about: everything before it in the form.
                var before = field == "담당" ? (string[])["부서", "유형"] : ["부서", "유형", "담당"];
                var values = document.Values.Where(v => before.Contains(v.Key)).ToDictionary(v => v.Key, v => v.Value);
                var suggestion = (await vault.SuggestAsync(new SuggestRequest("approved@1", field, values), ct))!;
                var (right, wrong, abstained, promised) = tally[field];
                if (suggestion.Value is null) abstained++;
                else
                {
                    if (suggestion.Value == document.Values[field].GetString()) right++;
                    else wrong++;
                    if ((await vault.CurvesAsync(ct)).Single(c => c.Field == field).Replay?.Precision is { } precision)
                        promised.Add(precision);
                }
                tally[field] = (right, wrong, abstained, promised);
            }
            await vault.IngestAsync(new VaultSnapshot(all.Templates, [.. all.Documents.Take(i + 1)]), ct);
            await vault.ThresholdsSelected.WaitAsync(ct);
        }

        await Measurement.ReportAsync(
            $"judged on judged · {confirmed} confirmed · {asked} asked · " + string.Join(" · ", tally.Select(t =>
                $"{t.Key}: right {t.Value.Right} wrong {t.Value.Wrong} abstained {t.Value.Abstained}"
                + $" ({(t.Value.Right + t.Value.Wrong == 0 ? 0 : 100.0 * t.Value.Right / (t.Value.Right + t.Value.Wrong)):F0}% right,"
                + $" promised {(t.Value.Promised.Count == 0 ? 0 : 100 * t.Value.Promised.Average()):F0}%)")), ct);
    }
}
