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

        var answered = new List<(double Similarity, bool Right)>();
        var abstained = 0;
        foreach (var document in all.Documents.Skip(confirmed))
        {
            var values = document.Values.Where(v => v.Key != "담당").ToDictionary(v => v.Key, v => v.Value);
            var suggestion = (await vault.SuggestAsync(new SuggestRequest("intake@1", "담당", values), ct))!;
            if (suggestion.Value is null) abstained++;
            else answered.Add((suggestion.Similarity ?? 1, suggestion.Value == document.Values["담당"].GetString()));
        }

        var ordered = answered.OrderBy(a => a.Similarity).ToList();
        var quarters = Enumerable.Range(0, 4).Select(q =>
        {
            var part = ordered.Skip(q * ordered.Count / 4).Take((q + 1) * ordered.Count / 4 - q * ordered.Count / 4).ToList();
            return part.Count == 0 ? "-" : $"{part.Min(a => a.Similarity):F2}~{part.Max(a => a.Similarity):F2} {100.0 * part.Count(a => a.Right) / part.Count:F0}% ({part.Count})";
        });
        var line = $"calibration noise {noise:P0} mixed {mixed:P0} generic {generic:P0} · {confirmed} confirmed · {asked} asked · {curve.WhyNoReplay ?? "replay"} threshold {replay?.Threshold:F4} precision {replay?.Precision:P0} answered {replay?.AnswerRate:P0}"
            + $" · live answered {answered.Count} right {answered.Count(a => a.Right)} ({(answered.Count == 0 ? 0 : 100.0 * answered.Count(a => a.Right) / answered.Count):F0}%) abstained {abstained}"
            + $" · by similarity, lowest quarter first: {string.Join(" | ", quarters)}";
        TestContext.Current.TestOutputHelper?.WriteLine(line);
        if (Environment.GetEnvironmentVariable("LOWLINE_PERF_OUT") is { Length: > 0 } output)
            await File.AppendAllTextAsync(output, line + Environment.NewLine, ct);
    }
}
