using System.Text.Json;
using Microsoft.AspNetCore.Http;

namespace Lowline.Host.Tests;

/// <summary>Reading records out of pasted text, against stand-ins on this computer — nothing leaves it.</summary>
public sealed class ChatExtractionTests
{
    private static CancellationToken Ct => TestContext.Current.CancellationToken;

    private const string Template = "---\nid: intake\nversion: 1\nlowline:\n  suggest: [긴급도]\n---\n@요청자: [text]\n@긴급도: [radio options=\"낮음,보통,높음\"]\n";

    private const string Pasted = "김민수 님이 10월 2일에 보낸 요청 — 서버가 멈춤, 매우 급함\n이지은 님 요청: 모니터 교체, 급하지 않음";

    [Fact]
    public async Task Tells_the_model_how_to_answer_and_the_template_then_gives_it_the_text_alone()
    {
        JsonElement? asked = null;
        var (app, baseUrl) = await ModelConnectionTests.StandIn(async context =>
        {
            asked = await JsonSerializer.DeserializeAsync<JsonElement>(context.Request.Body, cancellationToken: Ct);
            await context.Response.WriteAsJsonAsync(new
            {
                id = "c1",
                @object = "chat.completion",
                created = 0,
                model = "small-4b",
                choices = new[] { new { index = 0, message = new { role = "assistant", content = "```json\n[]\n```" }, finish_reason = "stop" } },
            }, Ct);
        });
        await using var _ = app;
        await using var local = new LocalModels(new LocalModelsTests.StandIn());

        var reply = await ChatExtraction.ReplyAsync(new ChatExtractRequest("custom", baseUrl, null, "small-4b", Template, Pasted), local, TimeSpan.FromSeconds(20), Ct);

        Assert.Equal((true, "```json\n[]\n```", null), (reply.Ok, reply.Text, reply.Failure));
        var messages = asked!.Value.GetProperty("messages").EnumerateArray().ToList();
        Assert.Equal(["system", "user"], messages.Select(m => m.GetProperty("role").GetString()));
        var system = messages[0].GetProperty("content").ToString();
        Assert.Contains("JSON 배열", system);
        Assert.Contains("추측해서 채우지 않습니다", system);
        Assert.Contains("@긴급도: [radio options=\"낮음,보통,높음\"]", system); // the template, whose fields the records fill
        Assert.Equal(Pasted, messages[1].GetProperty("content").ToString()); // the text, and nothing of the vault
    }

    [Fact]
    public async Task Reads_on_a_model_on_this_computer_too()
    {
        var lmsupply = new LocalModelsTests.StandIn { Reply = "```json\n[{\"요청자\": \"김민수\"}]\n```" };
        await using var local = new LocalModels(lmsupply);

        var reply = await ChatExtraction.ReplyAsync(new ChatExtractRequest(ChatAuthoring.LocalPreset, null, null, "gguf:qwen3-default", Template, Pasted), local, TimeSpan.FromSeconds(20), Ct);

        Assert.True(reply.Ok);
        Assert.Contains("김민수", reply.Text);
        Assert.Equal(Pasted, lmsupply.Loaded.Single().Asked[^1].Content);
    }

    [Fact]
    public async Task Asks_nothing_of_no_text()
    {
        await using var local = new LocalModels(new LocalModelsTests.StandIn());

        var reply = await ChatExtraction.ReplyAsync(new ChatExtractRequest("custom", "http://127.0.0.1:9/v1", null, "m", Template, "  "), local, TimeSpan.FromSeconds(20), Ct);

        Assert.Equal((false, ModelFailure.Invalid), (reply.Ok, reply.Failure));
    }

    [Fact]
    public async Task A_question_goes_to_the_model_with_the_template_and_today_never_a_document()
    {
        var lmsupply = new LocalModelsTests.StandIn { Reply = "```json\n{\"groupBy\": [\"긴급도\"]}\n```" };
        await using var local = new LocalModels(lmsupply);

        var reply = await ChatQuery.ReplyAsync(new ChatQueryRequest(ChatAuthoring.LocalPreset, null, null, "gguf:qwen3-default", Template, "긴급도별로 몇 건?"), local, TimeSpan.FromSeconds(20), Ct);

        Assert.True(reply.Ok);
        var asked = lmsupply.Loaded.Single().Asked;
        Assert.Equal(2, asked.Count);
        Assert.Contains("세는 일은 Lowline이 합니다", asked[0].Content);
        Assert.Contains(DateTime.Now.ToString("yyyy-MM-dd"), asked[0].Content);
        // A span relative to today is named, never worked out: the app turns it into days.
        Assert.Contains("\"op\": \"period\", \"value\": \"last-month\"", asked[0].Content);
        Assert.Contains("unanswerable", asked[0].Content);
        Assert.Contains("@긴급도: [radio options=\"낮음,보통,높음\"]", asked[0].Content);
        Assert.Equal("긴급도별로 몇 건?", asked[1].Content);
        Assert.False((await ChatQuery.ReplyAsync(new ChatQueryRequest(ChatAuthoring.LocalPreset, null, null, "gguf:qwen3-default", Template, " "), local, TimeSpan.FromSeconds(20), Ct)).Ok);
        // No field refers to another template's documents: nothing is said about them.
        Assert.DoesNotContain("다른 서식의 문서를 가리키는 칸", asked[0].Content);
    }

    [Fact]
    public async Task A_question_is_told_the_fields_of_the_documents_the_template_refers_to_by_name_and_choices()
    {
        var lmsupply = new LocalModelsTests.StandIn { Reply = "```json\n{\"groupBy\": [\"고객.지역\"]}\n```" };
        await using var local = new LocalModels(lmsupply);
        ReferredColumn[] referred = [new("고객.지역", "select", ["서울", "부산"]), new("고객.등록일", "date"), new("고객.이름", "text")];

        var reply = await ChatQuery.ReplyAsync(
            new ChatQueryRequest(ChatAuthoring.LocalPreset, null, null, "gguf:qwen3-default", "@고객 -> customer: [select]", "지역별 문의 수?", referred),
            local, TimeSpan.FromSeconds(20), Ct);

        Assert.True(reply.Ok);
        var told = lmsupply.Loaded.Single().Asked[0].Content;
        Assert.Contains("다른 서식의 문서를 가리키는 칸", told);
        Assert.Contains("- `고객.지역` (선택지: 서울, 부산)", told);
        Assert.Contains("- `고객.등록일` (날짜)", told);
        Assert.Contains("- `고객.이름`", told);
        Assert.Contains("그 칸(예: `고객`)에 `equal`과 그 문서의 이름", told);
        Assert.DoesNotContain("이 서식의 문서를 가리키는 다른 서식", told);
    }

    [Fact]
    public async Task A_question_is_told_the_templates_whose_documents_refer_to_its_own_and_how_to_count_them_by_the_document_each_names()
    {
        var lmsupply = new LocalModelsTests.StandIn { Reply = "```json\n{\"of\": \"문의\", \"groupBy\": [\"고객\"]}\n```" };
        await using var local = new LocalModels(lmsupply);
        ReferringTemplate[] referring = [new("문의", ["고객"], [new("고객", "select"), new("분류", "select", ["배송", "반품"]), new("고객.지역", "select", ["서울", "부산"])])];

        var reply = await ChatQuery.ReplyAsync(
            new ChatQueryRequest(ChatAuthoring.LocalPreset, null, null, "gguf:qwen3-default", "상호: ___@상호", "문의가 많은 고객?", Referring: referring),
            local, TimeSpan.FromSeconds(20), Ct);

        Assert.True(reply.Ok);
        var told = lmsupply.Loaded.Single().Asked[0].Content;
        Assert.Contains("이 서식의 문서를 가리키는 다른 서식", told);
        Assert.Contains("- `문의` — `고객` 칸이 이 서식의 문서를 가리킵니다. 셀 수 있는 칸: `고객`, `분류` (선택지: 배송, 반품), `고객.지역` (선택지: 서울, 부산)", told);
        Assert.Contains("""`{"of": "문의", "groupBy": ["고객"]}`""", told);
        Assert.DoesNotContain("다른 서식의 문서를 가리키는 칸(`-> 서식`)", told);
    }
}
