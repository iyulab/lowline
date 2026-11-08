using System.Diagnostics;
using System.Diagnostics.Metrics;
using System.Text;
using System.Text.Json;
using Microsoft.Extensions.AI;

namespace Lowline.Extensions.AI;

/// <summary>How a <see cref="ChatClientLowlineModel"/> uses its chat client.</summary>
public sealed record ChatClientLowlineModelOptions
{
    /// <summary>Whether the chat client may talk to a service on another machine. Off by default: a client whose
    /// <see cref="ChatClientMetadata.ProviderUri"/> names a host other than this machine is refused when the model is
    /// made, so what a person wrote or showed leaves the machine only when the host says it may. A client that names no
    /// address is taken to run in the process.</summary>
    public bool AllowRemote { get; init; }

    /// <summary>Whether the model judges a decided field the records could not answer
    /// (<see cref="ILowlineModel.JudgeAsync"/>). On by default.</summary>
    public bool Judge { get; init; } = true;

    /// <summary>The probability, on the model's own scale, from which a judged value is trusted — only a trusted value
    /// is shown. 0.7 by default.</summary>
    public double TrustFrom { get; init; } = 0.7;

    /// <summary>Options passed with every request, such as the model id; the response format is set to JSON over
    /// them.</summary>
    public ChatOptions? ChatOptions { get; init; }
}

/// <summary>The Lowline engine's model over a <see cref="IChatClient"/>: it asks the client for the fields of a form it
/// can tell from what a person wrote or showed, and for its values for a decided field the records could not answer.
/// It sends the client what the engine's request holds — the form's name, the fields to fill with their kinds and
/// choices, the text, the attachments and the values the record holds — and nothing else; whatever the client answers
/// the engine checks against its field and shows as a suggestion for the person to take.</summary>
/// <remarks>Every answer is counted on <see cref="AnswersCounter"/> of the meter <see cref="MeterName"/>, tagged with
/// what was asked (<c>lowline.operation</c>: <c>fill</c> or <c>judge</c>), the form (<c>lowline.form</c>) and what came
/// of it (<c>lowline.outcome</c>): <c>answered</c> — a value was kept; <c>unknown</c> — the model said it could not
/// tell; <c>unreadable</c> — the answer was not in the shape asked for, with why in <c>lowline.reason</c>. An unreadable
/// answer suggests nothing, as an unknown one does; the count is how a host tells that its model answers in a shape the
/// engine cannot use. A value skipped inside an answer whose other values were kept — a field or a judged value not in
/// the shape asked for — is counted on <see cref="SkippedCounter"/>, tagged with the operation, the form and
/// <c>lowline.reason</c>.</remarks>
public sealed class ChatClientLowlineModel : ILowlineModel
{
    /// <summary>The name of the meter the model counts its answers on.</summary>
    public const string MeterName = "Lowline.Extensions.AI";

    /// <summary>The counter of answers the model had from its chat client.</summary>
    public const string AnswersCounter = "lowline.model.answers";

    /// <summary>The counter of values skipped in answers whose other values were kept, each tagged with why.</summary>
    public const string SkippedCounter = "lowline.model.values.skipped";

    private static readonly Meter Meter = new(MeterName);

    private static readonly Counter<long> Skipped = Meter.CreateCounter<long>(
        SkippedCounter, unit: "{value}", description: "Values skipped in a model's answers, by why.");

    private static readonly Counter<long> Answers = Meter.CreateCounter<long>(
        AnswersCounter, unit: "{answer}", description: "Answers a model gave, by what came of them.");

    private readonly IChatClient _client;
    private readonly ChatClientLowlineModelOptions _options;

    /// <summary>A model over <paramref name="client"/>.</summary>
    /// <exception cref="InvalidOperationException">The client talks to another machine and
    /// <see cref="ChatClientLowlineModelOptions.AllowRemote"/> is off.</exception>
    public ChatClientLowlineModel(IChatClient client, ChatClientLowlineModelOptions? options = null)
    {
        ArgumentNullException.ThrowIfNull(client);
        _client = client;
        _options = options ?? new ChatClientLowlineModelOptions();
        var address = client.GetService<ChatClientMetadata>()?.ProviderUri;
        if (!_options.AllowRemote && address is not null && !IsThisMachine(address))
        {
            throw new InvalidOperationException(
                $"The chat client talks to {address.Host}, another machine; set AllowRemote to send it what people write.");
        }
    }

    private static bool IsThisMachine(Uri address) =>
        address.IsLoopback || address.IsFile;

    /// <inheritdoc />
    public async Task<IReadOnlyDictionary<string, FieldValue>> FillAsync(
        LowlineFillRequest request, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(request);
        if (request.Fields.Count == 0)
        {
            return new Dictionary<string, FieldValue>();
        }

        var contents = new List<AIContent> { new TextContent(FillPrompt(request)) };
        foreach (var attachment in request.Attachments)
        {
            contents.Add(new DataContent(attachment.Content, attachment.MediaType) { Name = attachment.Name });
        }

        var answer = await AskAsync(FillInstructions, contents, cancellationToken).ConfigureAwait(false);
        var (filled, outcome, skipped) = ReadFill(answer, request.Fields);
        Count("fill", request.Form, outcome, skipped);
        return filled;
    }

    /// <inheritdoc />
    public async Task<IReadOnlyList<JudgedValue>> JudgeAsync(
        LowlineJudgeRequest request, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(request);
        if (!_options.Judge)
        {
            return [];
        }

        var answer = await AskAsync(JudgeInstructions, [new TextContent(JudgePrompt(request))], cancellationToken)
            .ConfigureAwait(false);
        var (judged, outcome, skipped) = ReadJudged(answer, request.Choices, _options.TrustFrom);
        Count("judge", request.Form, outcome, skipped);
        return judged;
    }

    private static void Count(string operation, string form, AnswerOutcome outcome, IReadOnlyList<string> skipped)
    {
        foreach (var why in skipped)
        {
            Skipped.Add(1, new TagList
            {
                { "lowline.operation", operation },
                { "lowline.form", form },
                { "lowline.reason", why },
            });
        }

        var tags = new TagList
        {
            { "lowline.operation", operation },
            { "lowline.form", form },
            { "lowline.outcome", outcome.Kind },
        };
        if (outcome.Reason is { } reason)
        {
            tags.Add("lowline.reason", reason);
        }

        Answers.Add(1, tags);
    }

    private async Task<string> AskAsync(string instructions, IList<AIContent> contents, CancellationToken cancellationToken)
    {
        var options = _options.ChatOptions?.Clone() ?? new ChatOptions();
        options.ResponseFormat = ChatResponseFormat.Json;
        var response = await _client.GetResponseAsync(
            [new ChatMessage(ChatRole.System, instructions), new ChatMessage(ChatRole.User, contents)],
            options,
            cancellationToken).ConfigureAwait(false);
        return response.Text;
    }

    internal const string FillInstructions =
        "You fill a form's fields from what a person wrote and any files they showed. Answer with one JSON object whose " +
        "keys are field names from \"fields\" and whose values are strings (an array of strings for a field that takes " +
        "several). Leave out every field the input does not tell — never guess. A choice field takes one of its " +
        "\"choices\" exactly. A number is written with digits, a date as YYYY-MM-DD, a time as HH:MM, a flag as true or " +
        "false. \"values\" is what the record already holds, for context only.";

    internal const string JudgeInstructions =
        "You judge the value of one decided field of a form that past records could not answer, from the values the " +
        "record holds. Answer with one JSON object {\"values\": [{\"value\": string, \"probability\": number}]}, best " +
        "first, probabilities between 0 and 1. When \"choices\" is given, use only those values exactly. Answer " +
        "{\"values\": []} when the evidence does not tell.";

    internal static string FillPrompt(LowlineFillRequest request) => Json(writer =>
    {
        writer.WriteString("form", request.Form);
        writer.WriteStartArray("fields");
        foreach (var field in request.Fields)
        {
            writer.WriteStartObject();
            writer.WriteString("name", field.Name);
            writer.WriteString("kind", KindName(field.Kind));
            if (field.Choices is { } choices)
            {
                WriteStrings(writer, "choices", choices);
            }

            writer.WriteEndObject();
        }

        writer.WriteEndArray();
        writer.WriteString("text", request.Text);
        WriteValues(writer, request.Values);
    });

    internal static string JudgePrompt(LowlineJudgeRequest request) => Json(writer =>
    {
        writer.WriteString("form", request.Form);
        writer.WriteString("field", request.Field);
        if (request.Choices is { } choices)
        {
            WriteStrings(writer, "choices", choices);
        }

        writer.WriteStartObject("evidence");
        foreach (var (name, value) in request.Evidence)
        {
            writer.WriteString(name, value);
        }

        writer.WriteEndObject();
        WriteValues(writer, request.Values);
    });

    /// <summary>What came of one answer: <c>answered</c>, <c>unknown</c>, or <c>unreadable</c> with why.</summary>
    internal readonly record struct AnswerOutcome(string Kind, string? Reason = null)
    {
        public static AnswerOutcome Answered { get; } = new("answered");

        public static AnswerOutcome Unknown { get; } = new("unknown");

        public static AnswerOutcome Unreadable(string reason) => new("unreadable", reason);
    }

    internal static (IReadOnlyDictionary<string, FieldValue> Filled, AnswerOutcome Outcome, IReadOnlyList<string> Skipped)
        ReadFill(string answer, IReadOnlyList<FillField> fields)
    {
        var filled = new Dictionary<string, FieldValue>();
        if (Parse(answer) is not { } root)
        {
            return (filled, AnswerOutcome.Unreadable("not-json"), []);
        }

        if (root.ValueKind != JsonValueKind.Object)
        {
            return (filled, AnswerOutcome.Unreadable("not-an-object"), []);
        }

        var asked = fields.ToDictionary(f => f.Name, StringComparer.Ordinal);
        var skipped = new List<string>();
        foreach (var property in root.EnumerateObject())
        {
            if (!asked.ContainsKey(property.Name))
            {
                continue;
            }

            switch (property.Value.ValueKind)
            {
                case JsonValueKind.String when property.Value.GetString() is { Length: > 0 } one:
                    filled[property.Name] = FieldValue.One(one);
                    break;
                case JsonValueKind.String or JsonValueKind.Null:
                    break;
                case JsonValueKind.Object:
                    skipped.Add("value-not-text");
                    break;
                case JsonValueKind.Number or JsonValueKind.True or JsonValueKind.False:
                    filled[property.Name] = FieldValue.One(property.Value.GetRawText());
                    break;
                case JsonValueKind.Array:
                    var many = property.Value.EnumerateArray()
                        .Where(e => e.ValueKind == JsonValueKind.String)
                        .Select(e => e.GetString()!)
                        .Where(s => s.Length > 0)
                        .ToArray();
                    if (many.Length > 0)
                    {
                        filled[property.Name] = FieldValue.Many(many);
                    }
                    else if (property.Value.EnumerateArray().Any(e => e.ValueKind != JsonValueKind.String))
                    {
                        skipped.Add("value-not-text");
                    }

                    break;
            }
        }

        // An answer with nothing usable is unreadable, and that is its count; one with a value kept says what it skipped.
        var outcome = filled.Count > 0 ? AnswerOutcome.Answered
            : skipped.Count > 0 ? AnswerOutcome.Unreadable(skipped[0])
            : AnswerOutcome.Unknown;
        return (filled, outcome, filled.Count > 0 ? skipped : []);
    }

    internal static (IReadOnlyList<JudgedValue> Judged, AnswerOutcome Outcome, IReadOnlyList<string> Skipped)
        ReadJudged(string answer, IReadOnlyList<string>? choices, double trustFrom)
    {
        if (Parse(answer) is not { } root)
        {
            return ([], AnswerOutcome.Unreadable("not-json"), []);
        }

        if (root.ValueKind != JsonValueKind.Object)
        {
            return ([], AnswerOutcome.Unreadable("not-an-object"), []);
        }

        if (!root.TryGetProperty("values", out var values) || values.ValueKind != JsonValueKind.Array)
        {
            return ([], AnswerOutcome.Unreadable("no-values"), []);
        }

        var judged = new List<JudgedValue>();
        var skipped = new List<string>();
        foreach (var each in values.EnumerateArray())
        {
            if (Judged(each, choices, trustFrom, out var why) is { } value)
            {
                judged.Add(value);
            }
            else
            {
                skipped.Add(why!);
            }
        }

        // An answer with nothing usable is unreadable, and that is its count; one with a value kept says what it skipped.
        var outcome = judged.Count > 0 ? AnswerOutcome.Answered
            : skipped.Count == 0 ? AnswerOutcome.Unknown
            : AnswerOutcome.Unreadable(skipped[0]);
        return (judged, outcome, judged.Count > 0 ? skipped : []);
    }

    /// <summary>One value of a judging answer, or <c>null</c> with why it is skipped.</summary>
    private static JudgedValue? Judged(JsonElement each, IReadOnlyList<string>? choices, double trustFrom, out string? why)
    {
        why = null;
        if (each.ValueKind != JsonValueKind.Object)
        {
            why = "item-not-an-object";
            return null;
        }

        if (!each.TryGetProperty("value", out var value) || value.ValueKind != JsonValueKind.String)
        {
            why = "value-not-text";
            return null;
        }

        // A probability is read only as a JSON number — "0.9" in quotes is skipped like any value the engine cannot
        // use, never read leniently (and TryGetDouble throws on an element that is not a number).
        if (!each.TryGetProperty("probability", out var probability) || probability.ValueKind != JsonValueKind.Number ||
            !probability.TryGetDouble(out var p))
        {
            why = "probability-not-a-number";
            return null;
        }

        if (p is < 0 or > 1)
        {
            why = "probability-out-of-range";
            return null;
        }

        var text = value.GetString()!;
        if (choices is not null && !choices.Contains(text, StringComparer.Ordinal))
        {
            why = "not-a-choice";
            return null;
        }

        return new JudgedValue(text, p, p >= trustFrom);
    }

    /// <summary>The answer as JSON, reading past a code fence a model may wrap it in; <c>null</c> when it is not
    /// JSON.</summary>
    private static JsonElement? Parse(string answer)
    {
        var text = answer.Trim();
        if (text.StartsWith("```", StringComparison.Ordinal))
        {
            var start = text.IndexOf('\n', StringComparison.Ordinal);
            var end = text.LastIndexOf("```", StringComparison.Ordinal);
            text = start >= 0 && end > start ? text[(start + 1)..end] : text;
        }

        try
        {
            using var document = JsonDocument.Parse(text);
            return document.RootElement.Clone();
        }
        catch (JsonException)
        {
            return null;
        }
    }

    private static string KindName(FieldKind kind) => kind switch
    {
        FieldKind.Text => "text",
        FieldKind.Number => "number",
        FieldKind.Date => "date",
        FieldKind.Choice => "choice",
        FieldKind.Flag => "flag",
        FieldKind.Reference => "reference",
        _ => "text",
    };

    private static void WriteStrings(Utf8JsonWriter writer, string name, IReadOnlyList<string> values)
    {
        writer.WriteStartArray(name);
        foreach (var value in values)
        {
            writer.WriteStringValue(value);
        }

        writer.WriteEndArray();
    }

    private static void WriteValues(Utf8JsonWriter writer, IReadOnlyDictionary<string, FieldValue> values)
    {
        writer.WriteStartObject("values");
        foreach (var (name, value) in values)
        {
            if (value.Text is { } one)
            {
                writer.WriteString(name, one);
            }
            else
            {
                WriteStrings(writer, name, value.Values);
            }
        }

        writer.WriteEndObject();
    }

    private static string Json(Action<Utf8JsonWriter> write)
    {
        using var stream = new MemoryStream();
        using (var writer = new Utf8JsonWriter(stream, new JsonWriterOptions { Indented = false }))
        {
            writer.WriteStartObject();
            write(writer);
            writer.WriteEndObject();
        }

        return Encoding.UTF8.GetString(stream.ToArray());
    }
}

/// <summary>Filling a host's forms through a <see cref="IChatClient"/>.</summary>
public static class ChatClientLowlineOptions
{
    /// <summary>Fills forms, and judges what the records could not answer, through <paramref name="client"/> — a
    /// <see cref="ChatClientLowlineModel"/>.</summary>
    /// <exception cref="InvalidOperationException">The client talks to another machine and
    /// <see cref="ChatClientLowlineModelOptions.AllowRemote"/> is off.</exception>
    public static T UseChatClient<T>(this T options, IChatClient client, ChatClientLowlineModelOptions? model = null)
        where T : LowlineOptions
    {
        ArgumentNullException.ThrowIfNull(options);
        options.UseModel(new ChatClientLowlineModel(client, model));
        return options;
    }
}
