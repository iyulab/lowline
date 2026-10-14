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
}
