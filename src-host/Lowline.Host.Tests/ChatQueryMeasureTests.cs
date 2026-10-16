using System.Diagnostics;
using System.Text.Encodings.Web;
using System.Text.Json;

namespace Lowline.Host.Tests;

/// <summary>
/// What a model on this computer makes of questions asked of documents others refer to — businesses and their
/// inspections, aircraft and their accidents: each question's reply, with the reply meant, for the app's side to judge
/// as the app reads them (<c>src/__tests__/chat-query-measure.test.ts</c>). A measurement, not a test of the model: only
/// that each reply arrives is asserted. Runs only with <c>LOWLINE_CHAT_MEASURE</c> naming the file to write and the
/// model (<c>LOWLINE_CHAT_MODEL</c>, the recommended one by default) already on this computer — nothing is fetched.
/// The file holds a line naming each set's template and referring templates, then a line for each of its questions.
/// </summary>
public sealed class ChatQueryMeasureTests
{
    /// <summary>A template asked about, the templates whose documents refer to it, and its questions with the replies meant.</summary>
    private sealed record Set(string Template, ReferringTemplate[] Referring, (string Question, string Meant)[] Cases);

    private static readonly Set Businesses = new(
        """
        ---
        id: food-business
        version: 1
        ---
        # 식품 업소

        상호: ___@상호

        @업소유형: [select options="Restaurant,Grocery Store,School,Bakery"]

        주소: ___@주소
        """,
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
        ],
        [
            ("검사를 가장 많이 받은 업소 5곳은?", """{"of": "식품 업소 검사", "groupBy": ["업소"], "top": 5}"""),
            ("불합격(Fail)이 나온 업소별로 몇 번이야?", """{"of": "식품 업소 검사", "groupBy": ["업소"], "filters": [{"field": "결과", "op": "equal", "value": "Fail"}]}"""),
            ("작년에 업소마다 검사를 몇 번 받았어?", """{"of": "식품 업소 검사", "groupBy": ["업소"], "filters": [{"field": "검사일", "op": "period", "value": "last-year"}]}"""),
            ("업소 유형별로 업소가 몇 곳?", """{"groupBy": ["업소유형"]}"""),
            ("업소 유형별 검사 결과는?", """{"of": "식품 업소 검사", "groupBy": ["업소.업소유형", "결과"]}"""),
            ("민원(Complaint) 검사가 가장 많은 업소 3곳?", """{"of": "식품 업소 검사", "groupBy": ["업소"], "filters": [{"field": "검사유형", "op": "equal", "value": "Complaint"}], "top": 3}"""),
            ("식당(Restaurant)은 몇 곳이야?", """{"filters": [{"field": "업소유형", "op": "equal", "value": "Restaurant"}]}"""),
            ("위험도 높음(Risk 1) 검사는 결과별로 몇 건?", """{"of": "식품 업소 검사", "groupBy": ["결과"], "filters": [{"field": "위험도", "op": "equal", "value": "Risk 1 (High)"}]}"""),
            ("업소별 불합격 비율은?", """{"unanswerable": "비율은 셀 수 없습니다"}"""),
            ("학교(School) 업소들은 검사를 모두 몇 번 받았어?", """{"of": "식품 업소 검사", "filters": [{"field": "업소.업소유형", "op": "equal", "value": "School"}]}"""),
        ]);

    // The aircraft register and the accidents naming its aircraft (public NTSB and FAA records): the pair is asked
    // about, more than suggested from — counts by aircraft kind run through the reference.
    private static readonly string[] Kinds =
        ["Fixed wing single engine", "Rotorcraft", "Fixed wing multi engine", "Glider", "Weight-shift-control", "Balloon", "Gyroplane", "Powered Parachute"];

    private static readonly string[] Engines = ["Reciprocating", "4 Cycle", "Turbo-shaft", "Turbo-prop", "None", "Turbo-fan", "2 Cycle", "Turbo-jet", "Electric"];

    private static readonly Set Aircraft = new(
        $"""
        ---
        id: aircraft-registry
        version: 1
        ---
        # 항공기

        등록번호: ___@등록번호

        제작사: ___@제작사

        모델: ___@모델

        제작연도: ___@제작연도

        @기체종류: [select options="{string.Join(',', Kinds)}"]

        @엔진종류: [select options="{string.Join(',', Engines)}"]
        """,
        [
            new("항공 사고", ["항공기"],
            [
                new("항공기", "select"),
                new("비행목적", "select",
                    ["PERS", "INST", "BUS", "AAPL", "POSI", "FLTS", "OWRK", "AOBV", "UNK", "FERY", "PUBF", "PUBU", "EXLD", "PUBS", "ASHO", "BANT", "SKYD", "FIRF", "GLDT", "EXEC"]),
                new("비행규정", "select", ["091", "135", "137", "PUBU", "121", "133"]),
                new("기상", "select", ["VMC", "IMC", "Unk"]),
                new("조명", "select", ["DAYL", "NITE", "DUSK", "NDRK", "DAWN", "NR"]),
                new("피해", "select", ["Substantial", "Destroyed", "Minor"]),
                new("최고부상", "select", ["None", "Minor", "Fatal", "Serious"]),
                new("항공기.제작사", "text"),
                new("항공기.모델", "text"),
                new("항공기.기체종류", "select", Kinds),
                new("항공기.엔진종류", "select", Engines),
            ]),
        ],
        [
            ("사고가 가장 많은 항공기 5대는?", """{"of": "항공 사고", "groupBy": ["항공기"], "top": 5}"""),
            ("기체 종류별로 항공기가 몇 대?", """{"groupBy": ["기체종류"]}"""),
            ("기체 종류별 사고 수는?", """{"of": "항공 사고", "groupBy": ["항공기.기체종류"]}"""),
            ("회전익(Rotorcraft) 항공기의 사고는 모두 몇 건?", """{"of": "항공 사고", "filters": [{"field": "항공기.기체종류", "op": "equal", "value": "Rotorcraft"}]}"""),
            ("사망(Fatal) 사고가 난 항공기별로 몇 건?", """{"of": "항공 사고", "groupBy": ["항공기"], "filters": [{"field": "최고부상", "op": "equal", "value": "Fatal"}]}"""),
            ("계기 기상(IMC)에서 난 사고는 피해별로 몇 건?", """{"of": "항공 사고", "groupBy": ["피해"], "filters": [{"field": "기상", "op": "equal", "value": "IMC"}]}"""),
            ("엔진 종류별 항공기 수는?", """{"groupBy": ["엔진종류"]}"""),
            ("사고가 가장 많은 제작사 3곳?", """{"of": "항공 사고", "groupBy": ["항공기.제작사"], "top": 3}"""),
            ("항공기별 평균 사고 피해는?", """{"unanswerable": "평균은 셀 수 없습니다"}"""),
            ("야간(NITE) 사고가 가장 많은 항공기 3대?", """{"of": "항공 사고", "groupBy": ["항공기"], "filters": [{"field": "조명", "op": "equal", "value": "NITE"}], "top": 3}"""),
        ]);

    private static readonly JsonSerializerOptions Json = new(JsonSerializerOptions.Web) { Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping };

    [Fact]
    public async Task Measures_replies_to_questions_of_referred_documents_and_those_referring_to_them()
    {
        var output = Environment.GetEnvironmentVariable("LOWLINE_CHAT_MEASURE");
        Assert.SkipWhen(string.IsNullOrEmpty(output), "set LOWLINE_CHAT_MEASURE to the file to write");
        var model = Environment.GetEnvironmentVariable("LOWLINE_CHAT_MODEL") ?? LocalModels.Offered[0];
        var generators = new LmSupplyGenerators();
        Assert.SkipUnless(generators.IsDownloaded(model), $"{model} is not on this computer");
        var ct = TestContext.Current.CancellationToken;
        await using var local = new LocalModels(generators);
        List<string> lines = [];
        foreach (var set in new[] { Businesses, Aircraft })
        {
            lines.Add(JsonSerializer.Serialize(new { model, template = set.Template, referring = set.Referring }, Json));
            foreach (var (question, meant) in set.Cases)
            {
                var clock = Stopwatch.StartNew();
                var reply = await ChatQuery.ReplyAsync(
                    new ChatQueryRequest(ChatAuthoring.LocalPreset, null, null, model, set.Template, question, Referring: set.Referring),
                    local, TimeSpan.FromMinutes(3), ct);
                clock.Stop();
                Assert.True(reply.Ok, $"{question}: {reply.Failure}");
                lines.Add(JsonSerializer.Serialize(new { question, meant, reply = reply.Text, ms = clock.ElapsedMilliseconds }, Json));
            }
        }
        await File.WriteAllLinesAsync(output!, lines, ct);
    }
}
