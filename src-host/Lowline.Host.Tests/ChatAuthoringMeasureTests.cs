using System.Diagnostics;
using System.Text.Encodings.Web;
using System.Text.Json;

namespace Lowline.Host.Tests;

/// <summary>
/// What a model on this computer makes of requests for templates, each starting from the template a new one starts as:
/// each request's reply, with the fields it asks for and the ones it asks to be judged, for the app's side to judge as
/// the app reads drafts (<c>src/__tests__/chat-authoring-measure.test.ts</c>). A measurement, not a test of the model:
/// only that each reply arrives is asserted. Runs only with <c>LOWLINE_CHAT_AUTHORING_MEASURE</c> naming the file to
/// write and the model (<c>LOWLINE_CHAT_MODEL</c>, the recommended one by default) already on this computer.
/// </summary>
public sealed class ChatAuthoringMeasureTests
{
    /// <summary>What a new template starts as (the app's <c>starterTemplate</c>); the app's side checks it still is.</summary>
    private const string Starter = """
        ---
        id: new-template
        version: 1
        ---
        # 새 서식

        제목: ___@제목

        @상태: [select options="열림,진행,닫힘"]

        @메모: [textarea rows=4]

        """;

    /// <summary>
    /// A request, the fields it names (a field counts when its name holds the word, spaces and underscores aside), and the
    /// ones it asks a person to judge from a closed list.
    /// </summary>
    private sealed record Case(string Id, string Ask, string[] Fields, string[] Judged);

    private static readonly Case[] Cases =
    [
        new("inquiry", "고객 문의 접수 서식으로 바꿔 줘. 고객 이름, 연락처, 문의 내용을 받고, 문의 유형(배송·환불·고장·기타)과 담당 부서(고객지원·물류·기술)는 사람이 판단해 고르는 칸으로 해 줘.",
            ["이름", "연락처", "내용", "유형", "부서"], ["유형", "부서"]),
        new("inspection", "설비 점검 기록 서식으로 바꿔 줘. 설비 번호, 점검일, 점검자, 점검 메모를 적고, 판정(정상·주의·이상)과 조치 시기(즉시·계획·불필요)는 사람이 판단해 고르는 칸으로 해 줘.",
            ["설비", "점검일", "점검자", "메모", "판정", "조치"], ["판정", "조치"]),
        new("nonconformity", "부적합 보고서 서식으로 바꿔 줘. 품목, 로트 번호, 발견일, 부적합 내용을 받고, 원인 분류(작업자·설비·자재·방법)와 처리 방법(재작업·폐기·특채)은 판단 칸으로 해 줘.",
            ["품목", "로트", "발견일", "내용", "원인", "처리"], ["원인", "처리"]),
        new("rental", "장비 대여 신청 서식으로 바꿔 줘. 신청자, 부서, 장비 이름, 대여 시작일과 반납일을 받고, 승인 여부(승인·보류·반려)는 사람이 판단해 고르는 칸으로 해 줘.",
            ["신청자", "부서", "장비", "시작", "반납", "승인"], ["승인"]),
        new("defect", "시설 하자 접수 서식으로 바꿔 줘. 위치, 발견일, 하자 내용을 받고, 하자 종류(누수·균열·전기·기타)와 책임 구분(시공사·관리주체·입주자)은 판단 칸으로 해 줘.",
            ["위치", "발견일", "내용", "종류", "책임"], ["종류", "책임"]),
        new("quote", "견적 요청 서식으로 바꿔 줘. 회사명, 담당자, 이메일, 품목과 수량, 희망 납기를 받고, 우선순위(일반·우선·긴급)는 사람이 판단해 고르는 칸으로 해 줘.",
            ["회사", "담당자", "이메일", "품목", "수량", "납기", "우선순위"], ["우선순위"]),
    ];

    private static readonly JsonSerializerOptions Json = new(JsonSerializerOptions.Web) { Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping };

    [Fact]
    public async Task Measures_drafts_of_templates_asked_for()
    {
        var output = Environment.GetEnvironmentVariable("LOWLINE_CHAT_AUTHORING_MEASURE");
        Assert.SkipWhen(string.IsNullOrEmpty(output), "set LOWLINE_CHAT_AUTHORING_MEASURE to the file to write");
        var model = Environment.GetEnvironmentVariable("LOWLINE_CHAT_MODEL") ?? LocalModels.Offered[0];
        var generators = new LmSupplyGenerators();
        Assert.SkipUnless(generators.IsDownloaded(model), $"{model} is not on this computer");
        var ct = TestContext.Current.CancellationToken;
        await using var local = new LocalModels(generators);
        List<string> lines = [JsonSerializer.Serialize(new { model, template = Starter }, Json)];
        foreach (var c in Cases)
        {
            var clock = Stopwatch.StartNew();
            var reply = await ChatAuthoring.ReplyAsync(
                new ChatAuthorRequest(ChatAuthoring.LocalPreset, null, null, model, Starter, [new ChatTurn("user", c.Ask)]),
                local, TimeSpan.FromMinutes(5), ct);
            clock.Stop();
            Assert.True(reply.Ok, $"{c.Id}: {reply.Failure}");
            lines.Add(JsonSerializer.Serialize(new { c.Id, c.Ask, c.Fields, c.Judged, reply = reply.Text, ms = clock.ElapsedMilliseconds }, Json));
        }
        await File.WriteAllLinesAsync(output!, lines, ct);
    }
}
