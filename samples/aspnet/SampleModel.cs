using System.Diagnostics.Metrics;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;

using Lowline.Extensions.AI;
using Microsoft.Extensions.AI;

namespace Lowline.Sample;

/// <summary>How the stand-in model answers when it is asked to judge a field the records cannot answer.</summary>
public enum StandInAnswer
{
    /// <summary>A choice, with a probability it is trusted at — what a model in good health gives.</summary>
    Knows,

    /// <summary>No value: the model says it cannot tell.</summary>
    DoesNotKnow,

    /// <summary>A choice with its probability in quotes (<c>"0.9"</c>) — a shape small models often give.</summary>
    QuotedProbability,

    /// <summary>A sentence instead of the JSON asked for.</summary>
    Prose,

    /// <summary>Two values: a choice as asked for, and another with its probability in quotes.</summary>
    Mixed,
}

/// <summary>A chat client standing in for a real model, so the sample runs anywhere and answers as the page asks: it
/// fills a field from the word written after its name ("customer Beta, owner lee"), and judges as
/// <see cref="Answers"/> says for the field it is asked to judge — so one field can be answered badly while another is
/// answered well, as a real model may.</summary>
public sealed partial class StandInChatClient : IChatClient
{
    /// <summary>How it answers a request to judge, by field; a field left out is answered as a model in good health
    /// answers (<see cref="StandInAnswer.Knows"/>).</summary>
    public System.Collections.Concurrent.ConcurrentDictionary<string, StandInAnswer> Answers { get; } = new();

    public Task<ChatResponse> GetResponseAsync(
        IEnumerable<ChatMessage> messages, ChatOptions? options = null, CancellationToken cancellationToken = default)
    {
        var asked = JsonNode.Parse(messages.Last().Text)!.AsObject();
        var answer = asked.ContainsKey("fields") ? Fill(asked) : Judge(asked);
        return Task.FromResult(new ChatResponse(new ChatMessage(ChatRole.Assistant, answer)));
    }

    private static string Fill(JsonObject asked)
    {
        var text = (string?)asked["text"] ?? "";
        var filled = new JsonObject();
        foreach (var field in asked["fields"]!.AsArray())
        {
            var name = (string)field!["name"]!;
            var found = Regex.Match(text, $@"\b{Regex.Escape(name)}\s*[:=]?\s*(\w+)", RegexOptions.IgnoreCase);
            if (found.Success)
            {
                filled[name] = found.Groups[1].Value;
            }
        }

        return filled.ToJsonString();
    }

    private string Judge(JsonObject asked)
    {
        // A rule standing in for judgement: the first choice that does not come before the first value it reads.
        var read = asked["evidence"]?.AsObject().Select(e => (string?)e.Value).FirstOrDefault() ?? "";
        var choices = asked["choices"]?.AsArray().Select(c => (string)c!).Order(StringComparer.OrdinalIgnoreCase).ToList()
            ?? [];
        var choice = choices.FirstOrDefault(c => string.Compare(c, read, StringComparison.OrdinalIgnoreCase) >= 0)
            ?? choices.FirstOrDefault() ?? read;
        return Answers.GetValueOrDefault((string?)asked["field"] ?? "") switch
        {
            StandInAnswer.Knows => $$"""{"values": [{"value": "{{choice}}", "probability": 0.9}]}""",
            StandInAnswer.DoesNotKnow => """{"values": []}""",
            StandInAnswer.QuotedProbability => $$"""{"values": [{"value": "{{choice}}", "probability": "0.9"}]}""",
            StandInAnswer.Mixed => $$"""{"values": [{"value": "{{choice}}", "probability": 0.9}, {"value": "{{choices.LastOrDefault() ?? choice}}", "probability": "0.1"}]}""",
            _ => $"The {asked["field"]} is probably {choice}.",
        };
    }

    public IAsyncEnumerable<ChatResponseUpdate> GetStreamingResponseAsync(
        IEnumerable<ChatMessage> messages, ChatOptions? options = null, CancellationToken cancellationToken = default) =>
        throw new NotSupportedException();

    public object? GetService(Type serviceType, object? serviceKey = null) =>
        serviceType == typeof(ChatClientMetadata) ? new ChatClientMetadata("stand-in") : null;

    public void Dispose()
    {
    }
}

/// <summary>A chat client over a server that speaks the OpenAI chat completions API — a local model server such as
/// Ollama or LM Studio, at <c>LOWLINE_SAMPLE_MODEL_URL</c> (for example <c>http://localhost:11434/v1</c>), with the model
/// named in <c>LOWLINE_SAMPLE_MODEL</c>.</summary>
public sealed class ChatCompletionsClient(Uri address, string model) : IChatClient
{
    private readonly HttpClient _http = new() { BaseAddress = new Uri(address.AbsoluteUri.TrimEnd('/') + "/") };

    public async Task<ChatResponse> GetResponseAsync(
        IEnumerable<ChatMessage> messages, ChatOptions? options = null, CancellationToken cancellationToken = default)
    {
        var body = new JsonObject
        {
            ["model"] = model,
            ["messages"] = new JsonArray(messages.Select(m => (JsonNode)new JsonObject
            {
                ["role"] = m.Role.Value,
                ["content"] = m.Text,
            }).ToArray()),
            ["response_format"] = new JsonObject { ["type"] = "json_object" },
        };
        using var response = await _http.PostAsJsonAsync("chat/completions", body, cancellationToken).ConfigureAwait(false);
        response.EnsureSuccessStatusCode();
        var answer = await response.Content.ReadFromJsonAsync<JsonObject>(cancellationToken).ConfigureAwait(false);
        var text = (string?)answer?["choices"]?[0]?["message"]?["content"] ?? "";
        return new ChatResponse(new ChatMessage(ChatRole.Assistant, text));
    }

    public IAsyncEnumerable<ChatResponseUpdate> GetStreamingResponseAsync(
        IEnumerable<ChatMessage> messages, ChatOptions? options = null, CancellationToken cancellationToken = default) =>
        throw new NotSupportedException();

    public object? GetService(Type serviceType, object? serviceKey = null) =>
        serviceType == typeof(ChatClientMetadata) ? new ChatClientMetadata("chat-completions", address, model) : null;

    public void Dispose() => _http.Dispose();
}

/// <summary>What the model's answers came to so far, read from the counter the engine's model keeps
/// (<see cref="ChatClientLowlineModel.AnswersCounter"/>): how a host sees the health of its model.</summary>
public sealed class ModelHealth : IDisposable
{
    private readonly MeterListener _listener = new();
    private readonly Dictionary<string, long> _counts = [];
    private string? _lastUnreadable;
    private long _skipped;
    private string? _lastSkipped;

    public ModelHealth()
    {
        _listener.InstrumentPublished = (instrument, listener) =>
        {
            if (instrument.Meter.Name == ChatClientLowlineModel.MeterName &&
                instrument.Name is ChatClientLowlineModel.AnswersCounter or ChatClientLowlineModel.SkippedCounter)
            {
                listener.EnableMeasurementEvents(instrument);
            }
        };
        _listener.SetMeasurementEventCallback<long>((instrument, value, tags, _) =>
        {
            string? outcome = null, reason = null;
            foreach (var tag in tags)
            {
                if (tag.Key == "lowline.outcome")
                {
                    outcome = tag.Value as string;
                }
                else if (tag.Key == "lowline.reason")
                {
                    reason = tag.Value as string;
                }
            }

            lock (_counts)
            {
                if (instrument.Name == ChatClientLowlineModel.SkippedCounter)
                {
                    _skipped += value;
                    _lastSkipped = reason;
                    return;
                }

                _counts[outcome ?? "unknown"] = _counts.GetValueOrDefault(outcome ?? "unknown") + value;
                if (outcome == "unreadable")
                {
                    _lastUnreadable = reason;
                }
            }
        });
        _listener.Start();
    }

    /// <summary>The counts by outcome, and why the last unreadable answer could not be read.</summary>
    public JsonObject Read()
    {
        lock (_counts)
        {
            return new JsonObject
            {
                ["answered"] = _counts.GetValueOrDefault("answered"),
                ["unknown"] = _counts.GetValueOrDefault("unknown"),
                ["unreadable"] = _counts.GetValueOrDefault("unreadable"),
                ["lastUnreadable"] = _lastUnreadable,
                ["skipped"] = _skipped,
                ["lastSkipped"] = _lastSkipped,
            };
        }
    }

    public void Dispose() => _listener.Dispose();
}
