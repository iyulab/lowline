using System.Text.Json;

namespace Lowline.Host.Tests;

/// <summary>
/// Whether the threshold replay chooses holds its precision near the threshold, not only on average — on
/// synthetic intake records with little duplication: several topic words per owner, filler words drawn at
/// random, some requests naming two owners' topics, some naming none, and some owners set against their
/// topic (people disagree). The answered suggestions are split by similarity into quarters, lowest first.
/// Runs only with <c>LOWLINE_PERF=1</c>; writes its figures to <c>LOWLINE_PERF_OUT</c> when set.
/// </summary>
public sealed class ThresholdCalibrationTests
{
    private static readonly TemplateSnapshot Intake = new("intake@1",
    [
        new TemplateField("요청", "textarea"),
        new TemplateField("담당", "select"),
    ], Suggest: ["담당"]);

    private static readonly (string Owner, string[] Topics)[] Owners =
    [
        ("장비", ["노트북", "모니터", "키보드", "마우스", "프린터", "정수기", "복합기", "충전기"]),
        ("인사", ["휴가", "연차", "급여", "명세서", "재직증명서", "채용", "근태", "출장비"]),
        ("재무", ["법인카드", "영수증", "정산", "세금계산서", "예산", "송금", "계좌", "비용"]),
        ("총무", ["회의실", "출입카드", "주차", "택배", "비품", "사무실", "좌석", "우편"]),
    ];

    private static readonly string[] Fillers =
    [
        "안녕하세요", "급하게", "오늘", "어제부터", "계속", "혹시", "확인", "부탁드립니다", "문의", "관련", "신청", "변경",
        "요청", "처리", "빨리", "다시", "새로", "안", "잘", "되나요", "합니다", "드려요", "해주세요", "가능할까요",
        "팀", "제", "저희", "건", "내용", "문제", "방법", "절차", "이번", "다음주",
    ];

    /// <param name="noise">The share of owners set against their topic.</param>
    /// <param name="mixed">The share of requests naming two owners' topics.</param>
    /// <param name="generic">The share of requests naming no topic.</param>
    private static VaultSnapshot Records(int count, int seed, double noise, double mixed, double generic)
    {
        var random = new Random(seed);
        string Words(int n) => string.Join(' ', Enumerable.Range(0, n).Select(_ => Fillers[random.Next(Fillers.Length)]));
        var documents = new List<DocumentSnapshot>(count);
        var start = new DateTimeOffset(2025, 1, 1, 0, 0, 0, TimeSpan.Zero);
        for (var i = 0; i < count; i++)
        {
            var (owner, topics) = Owners[random.Next(Owners.Length)];
            var roll = random.NextDouble();
            string request;
            if (roll < generic)
            {
                // No topic at all: nothing in it says whose it is.
                request = Words(4 + random.Next(4));
            }
            else if (roll < generic + mixed)
            {
                // Two owners' topics: the second one decides.
                var (other, otherTopics) = Owners[random.Next(Owners.Length)];
                request = $"{Words(2)} {otherTopics[random.Next(otherTopics.Length)]} {Words(2)} {topics[random.Next(topics.Length)]} {Words(2)}";
            }
            else
            {
                request = $"{Words(1 + random.Next(3))} {topics[random.Next(topics.Length)]} {Words(2 + random.Next(4))}";
            }
            // People disagree: one in ten goes to another owner than the topic says.
            if (random.NextDouble() < noise) owner = Owners[random.Next(Owners.Length)].Owner;
            var json = JsonSerializer.Deserialize<Dictionary<string, JsonElement>>(
                JsonSerializer.Serialize(new Dictionary<string, object> { ["요청"] = request, ["담당"] = owner }))!;
            documents.Add(new DocumentSnapshot($"문서/{i:D6}.md", "intake@1", json, start.AddMinutes(i * 37).ToUnixTimeMilliseconds()));
        }
        return new VaultSnapshot([Intake], documents, []);
    }

    [Theory]
    [InlineData(300, 300, 0.0, 0.0, 0.0)]
    [InlineData(300, 300, 0.05, 0.10, 0.05)]
    [InlineData(300, 300, 0.10, 0.15, 0.10)]
    [InlineData(1000, 300, 0.05, 0.10, 0.05)]
    public async Task Measures_precision_by_similarity(int confirmed, int asked, double noise, double mixed, double generic)
    {
        Assert.SkipUnless(Environment.GetEnvironmentVariable("LOWLINE_PERF") == "1", "set LOWLINE_PERF=1 to measure");
        var ct = TestContext.Current.CancellationToken;
        var all = Records(confirmed + asked, seed: confirmed, noise, mixed, generic);
        await using var vault = new VaultProjection();
        await vault.IngestAsync(new VaultSnapshot(all.Templates, [.. all.Documents.Take(confirmed)]), ct);
        await vault.ThresholdsSelected.WaitAsync(ct);
        var curve = (await vault.CurvesAsync(ct)).Single();
        var replay = curve.Replay;

        var answered = new List<bool>();
        var abstained = 0;
        foreach (var document in all.Documents.Skip(confirmed))
        {
            var values = document.Values.Where(v => v.Key != "담당").ToDictionary(v => v.Key, v => v.Value);
            var suggestion = (await vault.SuggestAsync(new SuggestRequest("intake@1", "담당", values), ct))!;
            if (suggestion.Value is null) abstained++;
            else answered.Add(suggestion.Value == document.Values["담당"].GetString());
        }

        var line = $"calibration noise {noise:P0} mixed {mixed:P0} generic {generic:P0} · {confirmed} confirmed · {asked} asked · {curve.WhyNoReplay ?? "replay"} threshold {replay?.Threshold:F4} precision {replay?.Precision:P0} answered {replay?.AnswerRate:P0}"
            + $" · live answered {answered.Count} right {answered.Count(a => a)} ({(answered.Count == 0 ? 0 : 100.0 * answered.Count(a => a) / answered.Count):F0}%) abstained {abstained}";
        await Measurement.ReportAsync(line, ct);
    }

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
