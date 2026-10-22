using System.Text.Json;
using System.Text.Json.Serialization;

namespace Lowline;

/// <summary>What a field holds: one text, or several for a field that takes several. The engine compares values as
/// text, exactly.</summary>
[JsonConverter(typeof(FieldValue.FieldValueConverter))]
public readonly record struct FieldValue
{
    private readonly string? _one;
    private readonly IReadOnlyList<string>? _many;

    private FieldValue(string? one, IReadOnlyList<string>? many)
    {
        _one = one;
        _many = many;
    }

    /// <summary>One value.</summary>
    public static FieldValue One(string value) => new(value, null);

    /// <summary>Several values, for a field that takes several.</summary>
    public static FieldValue Many(IReadOnlyList<string> values) => new(null, values);

    /// <summary>The one value, or <c>null</c> for several.</summary>
    public string? Text => _one;

    /// <summary>The values: several, or the one as a list of one.</summary>
    public IReadOnlyList<string> Values => _many ?? (_one is null ? [] : [_one]);

    /// <summary>One value.</summary>
    public static implicit operator FieldValue(string value) => One(value);

    /// <summary>Several values.</summary>
    public static implicit operator FieldValue(string[] values) => Many(values);

    internal sealed class FieldValueConverter : JsonConverter<FieldValue>
    {
        public override FieldValue Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)
        {
            if (reader.TokenType == JsonTokenType.String)
            {
                return One(reader.GetString()!);
            }

            var values = new List<string>();
            while (reader.Read() && reader.TokenType != JsonTokenType.EndArray)
            {
                values.Add(reader.GetString()!);
            }

            return Many(values);
        }

        public override void Write(Utf8JsonWriter writer, FieldValue value, JsonSerializerOptions options)
        {
            if (value._many is null)
            {
                writer.WriteStringValue(value._one ?? string.Empty);
                return;
            }

            writer.WriteStartArray();
            foreach (var each in value._many)
            {
                writer.WriteStringValue(each);
            }

            writer.WriteEndArray();
        }
    }
}

/// <summary>Who saved a record.</summary>
public enum SettledBy
{
    /// <summary>A person saved it — what they took, changed or typed teaches the decider.</summary>
    Person,

    /// <summary>The application saved it on its own: an import, another program's values.</summary>
    Application,
}

/// <summary>Which part of the records a suggestion came from.</summary>
[JsonConverter(typeof(JsonStringEnumConverter<Layer>))]
public enum Layer
{
    /// <summary>Values settled together with this record's other values.</summary>
    [JsonStringEnumMemberName("key")] Key,

    /// <summary>The records most like this one.</summary>
    [JsonStringEnumMemberName("similar")] Similar,

    /// <summary>A judgement the host made outside the records, which the decider took in.</summary>
    [JsonStringEnumMemberName("judgement")] Judgement,
}

/// <summary>Why a decided field is shown no suggestion.</summary>
[JsonConverter(typeof(JsonStringEnumConverter<Abstain>))]
public enum Abstain
{
    /// <summary>The form says the field is never suggested for.</summary>
    [JsonStringEnumMemberName("off")] Off,

    /// <summary>The records hold nothing that bears on the field yet.</summary>
    [JsonStringEnumMemberName("no-evidence")] NoEvidence,

    /// <summary>The records lean towards a value, but not as far as the field's threshold trusts.</summary>
    [JsonStringEnumMemberName("unsure")] Unsure,

    /// <summary>The records' value is not among the choices this person may pick now.</summary>
    [JsonStringEnumMemberName("not-allowed")] NotAllowed,

    /// <summary>Nothing in the records bears on the field, and a judgement from outside them could; see
    /// <see cref="Proposal.Asks"/>.</summary>
    [JsonStringEnumMemberName("needs-judgement")] NeedsJudgement,
}

/// <summary>A suggestion shown for a field: a value, or — when <see cref="Fit"/> is <c>prefix</c> — a class the value
/// begins with.</summary>
public sealed record Suggestion(
    [property: JsonPropertyName("value")] string Value,
    [property: JsonPropertyName("origin")] string Origin = "decider",
    [property: JsonPropertyName("fit")] string Fit = "exact");

/// <summary>What a suggestion rests on: another field's value it was settled under (<see cref="Kind"/> <c>value</c>),
/// or a settled record like this one and how alike, from 0 to 1 (<c>record</c>).</summary>
public sealed record Basis(
    [property: JsonPropertyName("kind")] string Kind,
    [property: JsonPropertyName("field")] string? Field = null,
    [property: JsonPropertyName("value")] string? Value = null,
    [property: JsonPropertyName("id")] string? Id = null,
    [property: JsonPropertyName("similarity")] double? Similarity = null);

/// <summary>What to show for one decided field: the suggestion and what it rests on, or why there is none.</summary>
public sealed record Proposal
{
    /// <summary>The decided field.</summary>
    [JsonPropertyName("field")] public required string Field { get; init; }

    /// <summary>The suggestion to show, if any.</summary>
    [JsonPropertyName("suggestion")] public Suggestion? Suggestion { get; init; }

    /// <summary>Whether the host may put the suggestion in as the field's starting value without a person taking it.
    /// </summary>
    [JsonPropertyName("prefill")] public bool Prefill { get; init; }

    /// <summary>Where the suggestion came from.</summary>
    [JsonPropertyName("layer")] public Layer? Layer { get; init; }

    /// <summary>What the suggestion rests on, strongest first.</summary>
    [JsonPropertyName("basis")] public IReadOnlyList<Basis> Basis { get; init; } = [];

    /// <summary>Why there is no suggestion, when there is none.</summary>
    [JsonPropertyName("abstain")] public Abstain? Abstain { get; init; }

    /// <summary>For <see cref="Lowline.Abstain.NeedsJudgement"/>: the fields and values a judgement from outside the
    /// records would read, each as a pair.</summary>
    [JsonPropertyName("asks")] public IReadOnlyList<IReadOnlyList<string>> Asks { get; init; } = [];
}

/// <summary>A saved record as the engine gives it back for the host to store: its id, when it was settled, and the
/// record itself as one line of JSON — what <see cref="LowlineEngine.Learn"/> reads back.</summary>
public sealed record SettledRecord(string Id, DateTimeOffset SettledAt, string Json);

/// <summary>Why an engine's thresholds should be chosen again.</summary>
public sealed record Staleness(string Reason, JsonElement? Detail = null);

[JsonSourceGenerationOptions(DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull)]
[JsonSerializable(typeof(List<Proposal>))]
[JsonSerializable(typeof(Dictionary<string, FieldValue>))]
[JsonSerializable(typeof(Dictionary<string, IReadOnlyList<string>>))]
[JsonSerializable(typeof(JsonElement))]
internal sealed partial class LowlineJson : JsonSerializerContext;
