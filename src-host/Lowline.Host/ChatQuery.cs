using Microsoft.Extensions.AI;

namespace Lowline.Host;

/// <summary>
/// What the shell asks to turn a question about a template's documents into a count to make: the model set up (the key
/// read for this one request), the template's source, and the question.
/// </summary>
public sealed record ChatQueryRequest(string Preset, string? BaseUrl, string? ApiKey, string Model, string Template, string Question);

/// <summary>
/// Asking the vault: the model turns a question into what to count — which fields to count by, which documents to keep —
/// and nothing more. It is given the template, never a document or a value; the counts, and the documents behind each,
/// come from the vault (<see cref="VaultProjection.AggregateAsync"/>), so an answer's numbers and evidence are the
/// vault's, never the model's. What the plan is worth is the app's to judge: it checks it against the template's fields.
/// </summary>
public static class ChatQuery
{
    /// <summary>What the model is told: what to answer with, the day it is — for "지난달" and the like — and the template.</summary>
    public static string Instructions(string template, DateOnly today) => $$"""
        당신은 Lowline 기록에 대한 질문을 「무엇을 셀지」로 바꾸는 도우미입니다. 기록을 직접 보지 않습니다 — 세는 일은 Lowline이 합니다.

        답하는 법:
        - JSON 객체 하나만 ```json 코드 블록에 담아 답합니다. 다른 말은 쓰지 않습니다.
        - `groupBy`: 무엇별로 셀지 — 칸 이름의 배열(`@` 없이). 전체 건수만 물으면 `[]`.
        - `filters`: 어떤 기록만 셀지 — `{"field": 칸 이름, "op": 조건, "value": 값}`의 배열. 조건은 `equal`(같음), `contains`(글에 포함), `atLeast`(이상), `atMost`(이하), `empty`(비어 있음, 값 없이), `period`(날짜 칸의 기간).
        - 「오늘·어제·이번 주·지난주·이번 달·지난달·올해·작년」은 날짜를 계산하지 말고 `period`로 씁니다 — 값은 `today`, `yesterday`, `this-week`, `last-week`, `this-month`, `last-month`, `this-year`, `last-year` 중 하나. 날짜는 Lowline이 셉니다.
        - 달 하나나 해 하나를 말하면 그것도 `period`로 씁니다 — 값은 달이면 `YYYY-MM`, 해면 `YYYY`. 오늘은 {{today:yyyy-MM-dd}}이니 「작년 12월」은 `{{today.Year - 1}}-12`, 「3월」은 `{{today.Year}}-03`입니다.
        - `period`의 값은 위의 낱말 하나, `YYYY-MM` 하나, `YYYY` 하나 중 하나입니다. 둘을 섞어 쓰지 않습니다.
        - 「9월 1일부터」처럼 날을 직접 말한 질문만 `atLeast`·`atMost`에 `YYYY-MM-DD`로 씁니다(연도를 말하지 않으면 올해).
        - `top`: 「상위 3개」처럼 몇 개만 물으면 그 수. 아니면 넣지 않습니다.
        - 칸 이름과 선택지는 서식에 있는 그대로 씁니다.
        - 질문이 서식의 어느 칸에도 적히지 않는 것을 물으면 비슷한 다른 칸으로 바꿔 세지 말고 `{"unanswerable": "이유"}`로 답합니다.

        예: 칸이 `원인`(부품·설정·사용자)·`방문일`(날짜)·`지역`(글)인 서식에서
        - 「지난달 원인 상위 2개?」
        ```json
        {"groupBy": ["원인"], "filters": [{"field": "방문일", "op": "period", "value": "last-month"}], "top": 2}
        ```
        - 「고객이 가장 많이 불평한 점은?」 — 불평을 적는 칸이 없다. `원인`은 고장의 원인이지 불평이 아니다.
        ```json
        {"unanswerable": "불평을 적는 칸이 없습니다"}
        ```

        서식:
        ```formdown
        {{template}}
        ```
        """;

    /// <summary>What to count for <paramref name="request"/>'s question, as the model's reply — or why there is none.</summary>
    public static Task<ChatReply> ReplyAsync(ChatQueryRequest request, LocalModels local, TimeSpan timeout, CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(request.Question)) return Task.FromResult(new ChatReply(false, null, ModelFailure.Invalid, null));
        List<ChatMessage> messages =
        [
            new(ChatRole.System, Instructions(request.Template, DateOnly.FromDateTime(DateTime.Now))),
            new(ChatRole.User, request.Question),
        ];
        return ChatAuthoring.SendAsync(new ChatModel(request.Preset, request.BaseUrl, request.ApiKey, request.Model), messages, local, timeout, cancellationToken);
    }
}
