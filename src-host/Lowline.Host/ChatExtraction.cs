using Microsoft.Extensions.AI;

namespace Lowline.Host;

/// <summary>
/// What the shell asks to read records out of text pasted to bring them in: the model set up (the key read for this one
/// request), the template's source, and the text.
/// </summary>
public sealed record ChatExtractRequest(string Preset, string? BaseUrl, string? ApiKey, string Model, string Template, string Text);

/// <summary>
/// Bringing records in from text that is not a table — mail, notes, a document's pages: the model reads the records out
/// as values of the template's fields, and nothing more. What they are worth is the app's to judge: it plans them as rows
/// pasted from a spreadsheet are planned, shows them, and the person brings them in. A value the model gave a judgment
/// field is brought in as a suggestion, never as a decision.
/// </summary>
public static class ChatExtraction
{
    /// <summary>
    /// What the model is told: how to answer, the day it is — a date without its year is of this one — and the template
    /// whose fields the records fill.
    /// </summary>
    public static string Instructions(string template, DateOnly today) => $$"""
        당신은 붙여 넣은 글에서 기록을 찾아 Lowline 서식의 칸 값으로 옮기는 도우미입니다.

        답하는 법:
        - JSON 배열 하나만 ```json 코드 블록에 담아 답합니다. 다른 말은 쓰지 않습니다.
        - 기록 하나가 객체 하나입니다. 키는 서식의 칸 이름 그대로(`@` 없이), 값은 문자열입니다.
        - 글에 적힌 것만 옮깁니다. 글에 없는 칸은 넣지 않고, 추측해서 채우지 않습니다.
        - 선택지가 있는 칸(`select`·`radio`·`checkbox`)은 글이 그중 어느 것인지 분명히 말할 때만, 그 선택지를 그대로 씁니다. 분명하지 않으면 그 칸은 넣지 않습니다.
        - 사람 이름에는 님·씨·고객 같은 호칭을 붙이지 않고 이름만 씁니다.
        - 날짜는 `YYYY-MM-DD`로 씁니다. 글에 해가 없으면 오늘({{today:yyyy-MM-dd}})이 속한 해로 봅니다.
        - 기록이 아닌 글(인사·서명·안내)은 옮기지 않습니다. 기록이 없으면 `[]`로 답합니다.

        예: 칸이 `요청자`·`접수일`·`긴급도`(낮음·보통·높음)·`담당`(설비·전기)인 서식에, 글이
        「김민수 님이 10월 2일에 보낸 요청 — 서버가 멈춤, 긴급도 높음, 설비 담당」
        「이지은 씨 10/3 요청: 조명 교체」이면
        ```json
        [{"요청자": "김민수", "접수일": "2026-10-02", "긴급도": "높음", "담당": "설비"}, {"요청자": "이지은", "접수일": "2026-10-03"}]
        ```
        이지은 씨의 긴급도와 담당은 글이 말하지 않으므로 넣지 않습니다.

        서식:
        ```formdown
        {{template}}
        ```
        """;

    /// <summary>The records the model reads out of <paramref name="request"/>'s text, as its reply — or why there is none.</summary>
    public static Task<ChatReply> ReplyAsync(ChatExtractRequest request, LocalModels local, TimeSpan timeout, CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(request.Text)) return Task.FromResult(new ChatReply(false, null, ModelFailure.Invalid, null));
        List<ChatMessage> messages = [new(ChatRole.System, Instructions(request.Template, DateOnly.FromDateTime(DateTime.Now))), new(ChatRole.User, request.Text)];
        return ChatAuthoring.SendAsync(new ChatModel(request.Preset, request.BaseUrl, request.ApiKey, request.Model), messages, local, timeout, cancellationToken);
    }
}
