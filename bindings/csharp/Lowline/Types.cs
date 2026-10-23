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

/// <summary>How a decided field was settled when its record was saved — what a record settled elsewhere says of each
/// field (<see cref="LowlineEngine.Record"/>). The decider counts its precision on the values a person settled with
/// nothing in view.</summary>
[JsonConverter(typeof(JsonStringEnumConverter<SettlementKind>))]
public enum SettlementKind
{
    /// <summary>The suggested value was taken as it was.</summary>
    Accept,

    /// <summary>A value other than the suggested one was settled while the suggestion was in view.</summary>
    Correct,

    /// <summary>The suggestion was turned down and the field left empty.</summary>
    Reject,

    /// <summary>The field held a value when the record was opened and was emptied.</summary>
    Revert,

    /// <summary>The value the record held when it was opened, saved again unchanged with no suggestion in view.</summary>
    Restore,

    /// <summary>The values of a field that takes several were settled.</summary>
    Set,

    /// <summary>A person settled a value with no suggestion in view.</summary>
    Enter,

    /// <summary>The application settled a value on its own — an import, another program's value.</summary>
    Fill,

    /// <summary>A person kept a value suggested by something other than the decider.</summary>
    AcceptOther,

    /// <summary>A person settled another value than one suggested by something other than the decider.</summary>
    CorrectOther,

    /// <summary>A person settled a value while the field's answer was held back for a check — given to
    /// <see cref="LowlineEngine.Record"/> through its checks, with the probability it was drawn with.</summary>
    Check,
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

/// <summary>Which settlements a decided field's precision was counted on when its thresholds were chosen
/// (<see cref="FieldReport.Counting"/>).</summary>
[JsonConverter(typeof(JsonStringEnumConverter<Counting>))]
public enum Counting
{
    /// <summary>Values settled with nothing in view, and checks.</summary>
    [JsonStringEnumMemberName("unprompted")] Unprompted,

    /// <summary>Every value a person settled, taken from a suggestion or not.</summary>
    [JsonStringEnumMemberName("settled")] Settled,
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

    /// <summary>A value from the host's model that is not one of the field's choices — never moved to a nearby one.
    /// </summary>
    [JsonStringEnumMemberName("not-a-choice")] NotAChoice,

    /// <summary>A value from the host's model that the field cannot hold: not a number, a date or a time as it takes
    /// them.</summary>
    [JsonStringEnumMemberName("malformed")] Malformed,
}

/// <summary>What kind of value a field takes.</summary>
[JsonConverter(typeof(JsonStringEnumConverter<FieldKind>))]
public enum FieldKind
{
    /// <summary>Free text.</summary>
    [JsonStringEnumMemberName("text")] Text,

    /// <summary>A number.</summary>
    [JsonStringEnumMemberName("number")] Number,

    /// <summary>A date or a time, as a form writes them (<c>2026-10-23</c>, <c>14:05</c>).</summary>
    [JsonStringEnumMemberName("date")] Date,

    /// <summary>One of a list of choices.</summary>
    [JsonStringEnumMemberName("choice")] Choice,

    /// <summary>On or off: <c>true</c> or <c>false</c>.</summary>
    [JsonStringEnumMemberName("flag")] Flag,

    /// <summary>A record the field names, such as a customer.</summary>
    [JsonStringEnumMemberName("reference")] Reference,
}

/// <summary>One field a host's model may fill: its name, the kind of value it takes, and — for a choice field that
/// takes nothing else — the values this person may pick.</summary>
public sealed record FillField(
    [property: JsonPropertyName("name")] string Name,
    [property: JsonPropertyName("kind")] FieldKind Kind,
    [property: JsonPropertyName("choices")] IReadOnlyList<string>? Choices = null);

/// <summary>A suggestion shown for a field: a value, or — when <see cref="Fit"/> is <c>prefix</c> — a class the value
/// begins with.</summary>
public sealed record Suggestion(
    [property: JsonPropertyName("value")] string Value,
    [property: JsonPropertyName("origin")] string Origin = "decider",
    [property: JsonPropertyName("fit")] string Fit = "exact");

/// <summary>A value the host's model ranked for a decided field the records could not answer: its probability on the
/// model's own scale, and whether the model trusts it. Only a trusted value among the field's choices is shown.</summary>
public sealed record JudgedValue(
    [property: JsonPropertyName("value")] string Value,
    [property: JsonPropertyName("probability")] double Probability,
    [property: JsonPropertyName("trusted")] bool Trusted);

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
    [JsonPropertyName("basis")] public IReadOnlyList<Basis> Basis { get => field ?? []; init; } = [];

    /// <summary>Why there is no suggestion, when there is none.</summary>
    [JsonPropertyName("abstain")] public Abstain? Abstain { get; init; }

    /// <summary>For <see cref="Lowline.Abstain.NeedsJudgement"/>: the fields and values a judgement from outside the
    /// records would read, each as a pair.</summary>
    [JsonPropertyName("asks")] public IReadOnlyList<IReadOnlyList<string>> Asks { get => field ?? []; init; } = [];
}

/// <summary>How often a decided field whose answer would be shown is drawn instead to be checked: its answer is held
/// back, and the value the person settles counts for the field's precision as a value settled with nothing in view,
/// weighted by one ÷ the rate. Without such draws, a field suggested well is settled mostly by taking the suggestion,
/// and the values its precision is counted on — those settled with nothing in view — run out. A field drawn is given to
/// <see cref="LowlineEngine.Record"/> among its checks, with the probability <see cref="Draw"/> answered.</summary>
/// <param name="Rate">The probability of a draw, fixed before it: above 0 and at most 1. One answer in twenty by
/// default.</param>
public sealed record Recheck(double Rate = 0.05)
{
    /// <summary>Whether to hold back the answer <paramref name="proposal"/> shows, given <paramref name="roll"/> — a
    /// number drawn uniformly from [0, 1) by the host, for this field of this record, before looking at the answer.
    /// Answers the probability the field was drawn with, or <c>null</c> when it is not drawn. Only a value the decider
    /// suggests is drawn: a class, a suggestion from elsewhere and a field shown nothing are left as they are.</summary>
    public double? Draw(Proposal proposal, double roll)
    {
        ArgumentNullException.ThrowIfNull(proposal);
        var checkable = proposal.Suggestion is { Origin: "decider", Fit: "exact" };
        return checkable && Rate > 0 && Rate <= 1 && roll < Rate ? Rate : null;
    }
}

/// <summary>A threshold chosen on a replay of the settled records, and what the replay saw at it: the share of answers
/// that matched (<see cref="Precision"/>), the share of lookups answered (<see cref="AnswerRate"/>), the answers and
/// lookups, and the precision to expect of the next answers (<see cref="Promise"/>, resting on
/// <see cref="PromiseAnswered"/> independent answers).</summary>
public sealed record ThresholdChoice(
    [property: JsonPropertyName("threshold")] double Threshold,
    [property: JsonPropertyName("precision")] double Precision,
    [property: JsonPropertyName("answer_rate")] double AnswerRate,
    [property: JsonPropertyName("answered")] int Answered,
    [property: JsonPropertyName("lookups")] int Lookups,
    [property: JsonPropertyName("promise")] double Promise,
    [property: JsonPropertyName("promise_answered")] double PromiseAnswered);

/// <summary>How one decided field's replays went when its thresholds were chosen
/// (<see cref="LowlineEngine.Report"/>).</summary>
public sealed record FieldReport
{
    /// <summary>The decided field.</summary>
    [JsonPropertyName("field")] public required string Field { get; init; }

    /// <summary>How many lookups the replay of values settled alongside made.</summary>
    [JsonPropertyName("lookups")] public int Lookups { get; init; }

    /// <summary>The threshold at which values settled alongside answer; <c>null</c> while none was right often enough.
    /// </summary>
    [JsonPropertyName("key")] public ThresholdChoice? Key { get; init; }

    /// <summary>When <see cref="Key"/> is <c>null</c>, the closest the replay came; <c>null</c> when too few were
    /// answered at any threshold to say.</summary>
    [JsonPropertyName("closest")] public ThresholdChoice? Closest { get; init; }

    /// <summary>The fields chosen to key it; <c>null</c> when every field it rests on does.</summary>
    [JsonPropertyName("keyFields")] public IReadOnlyList<string>? KeyFields { get; init; }

    /// <summary>For a free text field, the threshold for one, two, … characters typed (<c>null</c> where none was
    /// right often enough); <c>null</c> for any other field.</summary>
    [JsonPropertyName("typed")] public IReadOnlyList<ThresholdChoice?>? Typed { get; init; }

    /// <summary>For a field with a coarse level, the threshold at which its class is suggested.</summary>
    [JsonPropertyName("coarse")] public ThresholdChoice? Coarse { get; init; }

    /// <summary>The threshold at which the similar records layer answers, trusted or not.</summary>
    [JsonPropertyName("similar")] public ThresholdChoice? Similar { get; init; }

    /// <summary>Whether the similar records layer is offered for the field.</summary>
    [JsonPropertyName("similarOffered")] public bool SimilarOffered { get; init; }

    /// <summary>How many of the latest records each choice's <see cref="ThresholdChoice.Promise"/> is the precision
    /// over.</summary>
    [JsonPropertyName("promiseOver")] public int PromiseOver { get; init; }

    /// <summary>How many checks of the field are among the records.</summary>
    [JsonPropertyName("checks")] public int Checks { get; init; }

    /// <summary>How the field's precision was counted — with a tuning that counts every settled value until a field's
    /// checks gather (<c>"counting": {"settled-until-checked": {"checks": K}}</c>), which of the two its checks so far
    /// made it.</summary>
    [JsonPropertyName("counting")] public Counting Counting { get; init; }
}

/// <summary>A saved record as the engine gives it back for the host to store: its id, when it was settled, and the
/// record itself as one line of JSON — what <see cref="LowlineEngine.Learn"/> reads back.</summary>
public sealed record SettledRecord(string Id, DateTimeOffset SettledAt, string Json);

/// <summary>Why an engine's thresholds should be chosen again.</summary>
public sealed record Staleness(string Reason, JsonElement? Detail = null);

[JsonSourceGenerationOptions(DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull)]
[JsonSerializable(typeof(List<Proposal>))]
[JsonSerializable(typeof(List<FillField>))]
[JsonSerializable(typeof(List<JudgedValue>))]
[JsonSerializable(typeof(List<string>))]
[JsonSerializable(typeof(Proposal))]
[JsonSerializable(typeof(IReadOnlyList<Proposal>))]
[JsonSerializable(typeof(Dictionary<string, FieldValue>))]
[JsonSerializable(typeof(Dictionary<string, IReadOnlyList<string>>))]
[JsonSerializable(typeof(Dictionary<string, SettlementKind>))]
[JsonSerializable(typeof(Dictionary<string, double>))]
[JsonSerializable(typeof(List<FieldReport>))]
[JsonSerializable(typeof(JsonElement))]
internal sealed partial class LowlineJson : JsonSerializerContext;
