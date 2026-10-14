using System.Net.Http;
using System.Net.Sockets;
using IronProw.Core;
using IronProw.IronHive;
using LMSupply.Exceptions;
using Microsoft.Extensions.AI;
using Microsoft.Extensions.DependencyInjection;

namespace Lowline.Host;

/// <summary>One turn of the chat beside a template: who said it (<c>user</c> or <c>assistant</c>) and what.</summary>
public sealed record ChatTurn(string Role, string Text);

/// <summary>
/// What the shell asks for a chat reply about a template: the endpoint and model the person set up, the key the shell
/// read from the credential store for this one request (never kept here), the template's source as it stands in the
/// editor, and the conversation so far, the person's last message last.
/// </summary>
public sealed record ChatAuthorRequest(string Preset, string? BaseUrl, string? ApiKey, string Model, string Template, IReadOnlyList<ChatTurn> Turns);

/// <summary>The model's reply; or, when there is none, why — as one of <see cref="ModelFailure"/>'s, never the provider's words.</summary>
public sealed record ChatAuthorReply(bool Ok, string? Text, string? Failure, int? StatusCode);

/// <summary>
/// The chat that writes templates: what the model is told a Lowline template is, and one reply to the conversation.
/// What the reply's draft is worth — whether it parses, what is wrong in it — is the app's to judge: it shows the draft
/// in the editor and the person saves it.
/// </summary>
public static class ChatAuthoring
{
    /// <summary>How long a reply may take: under the shell's own limit for a request (two minutes), so the app hears the kind.</summary>
    public static readonly TimeSpan Deadline = TimeSpan.FromSeconds(100);

    /// <summary>What the model is told before the conversation: how a Lowline template is written, and the one it works on.</summary>
    public static string Instructions(string template) => $"""
        당신은 Lowline 서식을 함께 쓰는 도우미입니다. 서식은 Formdown 문법의 마크다운 파일 하나입니다.

        서식의 규칙:
        - 맨 앞 front matter에 `id`(영문 소문자·숫자·하이픈, 공백과 @ 없음)와 `version`(정수)을 둡니다. 판단 칸은 `lowline:` 아래 `suggest: [칸이름, …]`로 적습니다.
        - 칸 하나는 `@칸이름: [형식 속성]`으로 씁니다. 문장 안의 짧은 글 칸은 `제목: ___@제목`처럼 씁니다.
        - 형식: `text`, `textarea rows=3`, `number`, `date`, `email`, `select options="가,나,다"`, `radio options="가,나"`, `checkbox content="설명"`.
        - 칸 이름은 문서가 값을 적는 이름입니다. 한 서식에서 두 번 쓰지 않고, `template`과 `lowline`은 쓰지 않습니다. 띄어쓰기 대신 밑줄(`재현_절차`)을 씁니다.
        - 다른 서식의 문서를 가리키는 칸은 `@고객 -> customer: [select]`처럼 그 서식의 id를 화살표 뒤에 씁니다.
        - 판단 칸(사람이 판단해 고르는 칸)은 닫힌 선택지(`select`/`radio`)로 만들고 `lowline.suggest`에 넣습니다.

        답하는 법:
        - 한두 문장으로 무엇을 바꿨는지 말하고, 바뀐 서식 전체를 ```formdown 코드 블록 하나에 담습니다. 부분만 보내지 않습니다.
        - 사람이 묻기만 하면 코드 블록 없이 답합니다.
        - 사람이 쓴 칸 이름과 값은 바꾸지 않습니다. 요청하지 않은 칸을 지우지 않습니다.
        - 저장은 사람이 합니다. 저장했다고 말하지 않습니다.

        지금 서식:
        ```formdown
        {template}
        ```
        """;

    /// <summary>The preset of the model running on this computer (<see cref="LocalModels"/>) — Lowline's, not IronProw's.</summary>
    public const string LocalPreset = "local";

    /// <summary>
    /// One reply to <paramref name="request"/>'s conversation, as long as <paramref name="timeout"/> — on
    /// <paramref name="local"/> for <see cref="LocalPreset"/>, loading the model from what is here when it is not running.
    /// </summary>
    public static async Task<ChatAuthorReply> ReplyAsync(ChatAuthorRequest request, LocalModels local, TimeSpan timeout, CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(request.Model) || request.Turns.Count == 0)
            return new ChatAuthorReply(false, null, ModelFailure.Invalid, null);

        List<ChatMessage> messages = [new(ChatRole.System, Instructions(request.Template))];
        messages.AddRange(request.Turns.Select(t => new ChatMessage(t.Role == "assistant" ? ChatRole.Assistant : ChatRole.User, t.Text)));

        using var within = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        within.CancelAfter(timeout);
        try
        {
            if (request.Preset == LocalPreset)
            {
                var (chat, failure) = await local.ChatAsync(request.Model.Trim(), within.Token);
                if (chat is null) return new ChatAuthorReply(false, null, failure, null);
                return new ChatAuthorReply(true, (await chat.GetResponseAsync(messages, cancellationToken: within.Token)).Text, null, null);
            }
            return await RemoteAsync(request, messages, within.Token);
        }
        catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested)
        {
            return new ChatAuthorReply(false, null, ModelFailure.Timeout, null);
        }
        catch (Exception e) when (e is not OperationCanceledException && request.Preset == LocalPreset)
        {
            // The model's own server is on this computer: whatever broke, it did not run the request.
            return new ChatAuthorReply(false, null, e is ModelNotFoundException ? ModelFailure.NotDownloaded : ModelFailure.NotStarted, null);
        }
        catch (Exception e) when (e is not OperationCanceledException)
        {
            var (failure, status) = Failure(e);
            return new ChatAuthorReply(false, null, failure, status);
        }
    }

    /// <summary>A reply from an endpoint the person named — a server nearby or a company's service — through IronProw's presets.</summary>
    private static async Task<ChatAuthorReply> RemoteAsync(ChatAuthorRequest request, List<ChatMessage> messages, CancellationToken cancellationToken)
    {
        var endpoint = new ByoEndpoint(request.Preset, Blank(request.BaseUrl), Blank(request.ApiKey));
        if (ByoPresets.Validate(endpoint) is not null) return new ChatAuthorReply(false, null, ModelFailure.Invalid, null);

        var services = new ServiceCollection();
        services.AddIronProw().AddIronHiveByo("chat", 0, request.Model.Trim(), endpoint);
        await using var provider = services.BuildServiceProvider();
        var chat = provider.GetRequiredService<IChatClient>();
        var response = await chat.GetResponseAsync(messages, cancellationToken: cancellationToken);
        return new ChatAuthorReply(true, response.Text, null, null);
    }

    /// <summary>Why a call failed, as the probe words it: an HTTP answer by its status, a connection by what the socket said.</summary>
    public static (string Failure, int? StatusCode) Failure(Exception e)
    {
        if (new IronHiveHttpFailureReader().Read(e) is { } http)
            return (http.StatusCode is 401 or 403 ? ModelFailure.Unauthorized : ModelFailure.HttpStatus, http.StatusCode);
        for (var inner = e; inner is not null; inner = inner.InnerException)
        {
            if (inner is SocketException socket)
                return (socket.SocketErrorCode switch
                {
                    SocketError.ConnectionRefused => ModelFailure.Refused,
                    SocketError.HostNotFound or SocketError.NoData => ModelFailure.HostNotFound,
                    SocketError.NetworkUnreachable or SocketError.HostUnreachable or SocketError.NetworkDown => ModelFailure.Unreachable,
                    SocketError.TimedOut => ModelFailure.Timeout,
                    _ => ModelFailure.Transport,
                }, null);
            if (inner is TimeoutException) return (ModelFailure.Timeout, null);
            if (inner is HttpRequestException { StatusCode: { } code })
                return ((int)code is 401 or 403 ? ModelFailure.Unauthorized : ModelFailure.HttpStatus, (int)code);
        }
        return (ModelFailure.Transport, null);
    }

    private static string? Blank(string? text) => string.IsNullOrWhiteSpace(text) ? null : text.Trim();
}
