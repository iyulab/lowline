using System.Diagnostics;
using System.Text.Encodings.Web;
using System.Text.Json;

namespace Lowline.Host.Tests;

/// <summary>
/// What a model on this computer makes of questions asked of businesses whose inspections refer to them: each
/// question's reply, with the reply meant, for the app's side to judge as the app reads them
/// (<c>src/__tests__/chat-query-measure.test.ts</c>). A measurement, not a test of the model: only that each reply
/// arrives is asserted. Runs only with <c>LOWLINE_CHAT_MEASURE</c> naming the file to write and the model
/// (<c>LOWLINE_CHAT_MODEL</c>, the recommended one by default) already on this computer — nothing is fetched.
/// </summary>
public sealed class ChatQueryMeasureTests
{
    /// <summary>The businesses asked about; the app's side reads the same source from the file.</summary>
    private const string Business = """
        ---
        id: food-business
        version: 1
        ---
        # 식품 업소

        상호: ___@상호

        @업소유형: [select options="Restaurant,Grocery Store,School,Bakery"]

        주소: ___@주소
        """;

    private static readonly ReferringTemplate[] Referring =
    [
        new("식품 업소 검사", ["업소"],
        [
            new("업소", "select"),
            new("검사일", "date"),
            new("검사유형", "select", ["Canvass", "Canvass Re-Inspection", "Complaint", "License"]),
            new("위험도", "select", ["Risk 1 (High)", "Risk 2 (Medium)", "Risk 3 (Low)"]),
            new("결과", "select", ["Pass", "Fail", "Pass w/ Conditions", "No Entry"]),
            new("업소.상호", "text"),
            new("업소.업소유형", "select", ["Restaurant", "Grocery Store", "School", "Bakery"]),
        ]),
    ];

    /// <summary>A question, and a reply that counts what it asks.</summary>
    private static readonly (string Question, string Meant)[] Cases =
    [
        ("검사를 가장 많이 받은 업소 5곳은?", """{"of": "식품 업소 검사", "groupBy": ["업소"], "top": 5}"""),
        ("불합격(Fail)이 나온 업소별로 몇 번이야?", """{"of": "식품 업소 검사", "groupBy": ["업소"], "filters": [{"field": "결과", "op": "equal", "value": "Fail"}]}"""),
        ("작년에 업소마다 검사를 몇 번 받았어?", """{"of": "식품 업소 검사", "groupBy": ["업소"], "filters": [{"field": "검사일", "op": "period", "value": "last-year"}]}"""),
        ("업소 유형별로 업소가 몇 곳?", """{"groupBy": ["업소유형"]}"""),
        ("업소 유형별 검사 결과는?", """{"of": "식품 업소 검사", "groupBy": ["업소.업소유형", "결과"]}"""),
        ("민원(Complaint) 검사가 가장 많은 업소 3곳?", """{"of": "식품 업소 검사", "groupBy": ["업소"], "filters": [{"field": "검사유형", "op": "equal", "value": "Complaint"}], "top": 3}"""),
    ];

    private static readonly JsonSerializerOptions Json = new(JsonSerializerOptions.Web) { Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping };

    [Fact]
    public async Task Measures_replies_to_questions_of_businesses_and_their_inspections()
    {
        var output = Environment.GetEnvironmentVariable("LOWLINE_CHAT_MEASURE");
        Assert.SkipWhen(string.IsNullOrEmpty(output), "set LOWLINE_CHAT_MEASURE to the file to write");
        var model = Environment.GetEnvironmentVariable("LOWLINE_CHAT_MODEL") ?? LocalModels.Offered[0];
        var generators = new LmSupplyGenerators();
        Assert.SkipUnless(generators.IsDownloaded(model), $"{model} is not on this computer");
        var ct = TestContext.Current.CancellationToken;
        await using var local = new LocalModels(generators);
        List<string> lines = [JsonSerializer.Serialize(new { model, template = Business, referring = Referring }, Json)];
        foreach (var (question, meant) in Cases)
        {
            var clock = Stopwatch.StartNew();
            var reply = await ChatQuery.ReplyAsync(
                new ChatQueryRequest(ChatAuthoring.LocalPreset, null, null, model, Business, question, Referring: Referring),
                local, TimeSpan.FromMinutes(3), ct);
            clock.Stop();
            Assert.True(reply.Ok, $"{question}: {reply.Failure}");
            lines.Add(JsonSerializer.Serialize(new { question, meant, reply = reply.Text, ms = clock.ElapsedMilliseconds }, Json));
        }
        await File.WriteAllLinesAsync(output!, lines, ct);
    }
}
