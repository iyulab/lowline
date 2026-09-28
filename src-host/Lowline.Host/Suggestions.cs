using System.Text.Json;
using Gil;
using Gil.Forms;
using Gil.Memory;

namespace Lowline.Host;

/// <summary>
/// What the UI asks: a value for one judgment field, given the document's other values.
/// <see cref="Document"/> is the document's vault path once it has been saved.
/// </summary>
public sealed record SuggestRequest(
    string Template, string Field, IReadOnlyDictionary<string, JsonElement> Values, string? Document = null);

/// <summary>
/// A suggestion for one field. <see cref="Value"/> is null when there is none to make (<c>abstain</c>) —
/// nothing is guessed to fill the gap. <see cref="Source"/> is the document whose confirmed value it
/// comes from, and <see cref="Similarity"/> how close that document's other values are.
/// </summary>
public sealed record Suggestion(string? Value, string Mode, string? Source, double? Similarity);

/// <summary>
/// Suggestions for judgment fields from what people already confirmed in the vault — no model.
/// Each template with judgment fields is a Gil form: the fields its author turned suggestions on for are
/// judged, the rest observed. A saved document is a settled document of it, settled when it was last saved.
/// Documents say what the answer is; events say which suggestions were wrong — a field whose suggestion
/// was last rejected in a document is not offered there again.
/// </summary>
public sealed class Suggestions
{
    /// <summary>
    /// The similarity at which a similar document's value is offered while a field has too few confirmed
    /// documents to choose one from its own history.
    /// </summary>
    public const double PriorThreshold = 0.6;

    /// <summary>The share of offered values that must have been right for a threshold to be chosen.</summary>
    public const double TargetPrecision = 0.8;

    /// <summary>
    /// The fewest replayed answers a chosen threshold may rest on — the same number of decisions a
    /// correction curve's point is taken over.
    /// </summary>
    public const int MinimumAnswered = Curves.Window;

    /// <summary>
    /// The document id suggestions are asked under. Gil suggests only through a session, and a session puts
    /// its values into memory; unsaved values are not confirmed, so they are put under an id no saved document
    /// has, and only observed fields — which alone contribute nothing.
    /// TODO(upstream: docket iyulab/Gil#552) — ask with values, without putting them into memory.
    /// </summary>
    private const string QueryId = "\u0000query";

    private readonly LexicalMemory _memory = new();

    /// <summary>Keeps memory: every saved document goes through it.</summary>
    private readonly FormResolver _keeper;

    /// <summary>
    /// Answers: the same similar-document memory, and a settled-field memory that stays empty.
    /// TODO(upstream: docket iyulab/Gil#554) — a value settled alongside another field's value is offered before
    /// a similar document's, however little it predicts; on a free-text form that turns most suggestions wrong.
    /// Ask through the keeper once that layer has a threshold of its own.
    /// </summary>
    private readonly FormResolver _asker;
    private readonly Dictionary<string, TemplateSnapshot> _templates;
    private readonly Dictionary<string, List<SettledDocument>> _settled;
    private Dictionary<(string Template, string Field), FieldThreshold> _thresholds;
    private readonly HashSet<(string Doc, string Field)> _rejected;
    private Dictionary<string, FormDefinition> _forms = new(StringComparer.Ordinal);

    private Suggestions(
        Dictionary<string, TemplateSnapshot> templates,
        Dictionary<string, List<SettledDocument>> settled,
        Dictionary<(string, string), FieldThreshold> thresholds,
        IReadOnlyList<SuggestionEvent> events)
    {
        (_templates, _settled, _thresholds) = (templates, settled, thresholds);
        (_keeper, _asker) = (new FormResolver(new FieldMemory(), _memory), new FormResolver(new FieldMemory(), _memory));
        _rejected = Rejected(events);
        _forms = Forms();
    }

    /// <summary>
    /// The document fields whose latest event is a rejection. A later accept or correction in the same
    /// document means the field was filled in since, and lifts it.
    /// </summary>
    private static HashSet<(string, string)> Rejected(IReadOnlyList<SuggestionEvent> events) =>
        events
            .GroupBy(e => (e.Doc, e.Field))
            .Where(g => g.MaxBy(e => e.At, StringComparer.Ordinal)!.Kind == "reject")
            .Select(g => g.Key)
            .ToHashSet();

    /// <summary>
    /// Builds memory from the vault's saved documents, leaving out those with a conflict copy — their
    /// values are not confirmed until the person settles which copy to keep. Where documents disagree,
    /// Gil keeps the latest confirmation, so the order they come in does not matter. Each judgment field keeps the similarity
    /// threshold <paramref name="previous"/> chose for it until <see cref="SelectThresholdsAsync"/> chooses again.
    /// </summary>
    public static async Task<Suggestions> BuildAsync(VaultSnapshot vault, CancellationToken cancellationToken, Suggestions? previous = null)
    {
        var documents = vault.Documents.Where(d => !d.Conflicted).ToLookup(d => d.Template, StringComparer.Ordinal);
        var templates = vault.Templates
            .Where(t => t.Fields.Any(f => t.Suggest?.Contains(f.Name) == true))
            .ToDictionary(t => t.Ref, StringComparer.Ordinal);
        var settled = templates.Keys.ToDictionary(t => t, t => documents[t].Select(Settled).ToList(), StringComparer.Ordinal);
        var thresholds = new Dictionary<(string, string), FieldThreshold>();
        foreach (var template in templates.Values)
        {
            foreach (var field in template.Suggest!)
            {
                var confirmed = settled[template.Ref].Count(d => d.Values.ContainsKey(field));
                thresholds[(template.Ref, field)] = previous?._thresholds.GetValueOrDefault((template.Ref, field)) is { } kept
                    ? kept with { Confirmed = confirmed }
                    : new FieldThreshold(null, confirmed, SelectedAt: null);
            }
        }

        var suggestions = new Suggestions(templates, settled, thresholds, vault.Events ?? []);
        foreach (var template in templates.Values)
        {
            // Memory is kept for every judgment field; the threshold a field is asked at decides whether it is used.
            var remembering = Form(template, _ => PriorThreshold)!;
            await suggestions._keeper.RebuildAsync(remembering, settled[template.Ref], cancellationToken);
        }
        return suggestions;
    }

    /// <summary>
    /// Whether a field's threshold should be chosen again: it never was, or the field has gained or lost a
    /// tenth of its confirmed documents since — the right threshold moves as memory grows.
    /// </summary>
    public bool NeedsSelection => _thresholds.Values.Any(t =>
        t.SelectedAt is not { } at || Math.Abs(t.Confirmed - at) * 10 >= Math.Max(at, 10));

    /// <summary>
    /// Chooses each judgment field's threshold by replaying its confirmed documents in the order they were
    /// saved. The replay grows with the square of the history, so it runs apart from building memory and
    /// its result is applied with <see cref="Apply"/>.
    /// </summary>
    public async Task<IReadOnlyDictionary<(string Template, string Field), FieldThreshold>> SelectThresholdsAsync(CancellationToken cancellationToken)
    {
        var chosen = new Dictionary<(string, string), FieldThreshold>();
        foreach (var ((template, field), current) in _thresholds)
        {
            var bare = Form(_templates[template], _ => null)!;
            var choice = await ThresholdSelection.SelectAsync(
                new LexicalMemory(), bare, field, _settled[template], TargetPrecision, MinimumAnswered, cancellationToken);
            chosen[(template, field)] = new FieldThreshold(choice, current.Confirmed, current.Confirmed);
        }
        return chosen;
    }

    /// <summary>Uses thresholds <see cref="SelectThresholdsAsync"/> chose.</summary>
    public void Apply(IReadOnlyDictionary<(string Template, string Field), FieldThreshold> chosen)
    {
        // Replaced, not changed in place: a later build may be reading these as its previous thresholds.
        var thresholds = new Dictionary<(string, string), FieldThreshold>(_thresholds);
        foreach (var (key, threshold) in chosen)
        {
            if (thresholds.ContainsKey(key)) thresholds[key] = threshold;
        }
        _thresholds = thresholds;
        _forms = Forms();
    }

    /// <summary>How a judgment field's threshold was chosen, and how it did on the replay; null until it has been.</summary>
    public ThresholdChoice? Choice(string template, string field) => _thresholds.GetValueOrDefault((template, field))?.Choice;

    private Dictionary<string, FormDefinition> Forms() => _templates.Values.ToDictionary(
        t => t.Ref,
        t => Form(t, field => _thresholds[(t.Ref, field)].Threshold)!,
        StringComparer.Ordinal);

    /// <summary>A template as a Gil form, or null when its author turned suggestions on for no field.</summary>
    private static FormDefinition? Form(TemplateSnapshot template, Func<string, double?> threshold)
    {
        var judged = template.Suggest ?? [];
        if (!template.Fields.Any(f => judged.Contains(f.Name))) return null;
        // A judgment rests on the fields people fill in, not on other judgments: those are suggested too.
        var observed = template.Fields.Where(f => !judged.Contains(f.Name)).Select(f => f.Name).ToList();
        var fields = template.Fields.Select(f => judged.Contains(f.Name)
            ? new FieldDefinition(f.Name, FieldRole.Judged) { MemoryThreshold = threshold(f.Name), DependsOn = observed }
            : new FieldDefinition(f.Name, FieldRole.Observed));
        // No model is called, so the language is never used.
        return new FormDefinition(template.Ref, [.. fields], PromptLanguage.English);
    }

    /// <summary>
    /// A saved document as Gil sees it: its values as text, settled when the file was last written — the
    /// oldest possible time when that is unknown, as the shell reports an unreadable one.
    /// </summary>
    private static SettledDocument Settled(DocumentSnapshot document) => new(
        document.Path,
        Texts(document.Values),
        DateTimeOffset.FromUnixTimeMilliseconds(document.Modified ?? 0));

    private static Dictionary<string, string> Texts(IReadOnlyDictionary<string, JsonElement> values) =>
        values
            .Select(v => (v.Key, Text: Answer(v.Value)))
            .Where(v => v.Text is not null)
            .ToDictionary(v => v.Key, v => v.Text!, StringComparer.Ordinal);

    public async Task<Suggestion?> SuggestAsync(SuggestRequest request, CancellationToken cancellationToken)
    {
        if (!_forms.TryGetValue(request.Template, out var form)) return null;
        if (form.Fields.FirstOrDefault(f => f.Name == request.Field) is not { Role: FieldRole.Judged }) return null;
        if (request.Document is { } document && _rejected.Contains((document, request.Field)))
            return new Suggestion(null, "rejected", null, null);

        var session = _asker.Open(form, QueryId);
        foreach (var (field, value) in Texts(request.Values))
        {
            if (form.Fields.Any(f => f.Name == field && f.Role == FieldRole.Observed))
                await session.ObserveAsync(field, value, cancellationToken);
        }
        var suggestion = (await session.SuggestAsync(cancellationToken)).Single(s => s.Field == request.Field);

        // Never the document's own saved version.
        var similar = suggestion.Candidates.FirstOrDefault(c =>
            c.Source == FieldSource.SimilarDocument && c.Evidence != request.Document);
        return similar is null
            ? new Suggestion(null, "abstain", null, null)
            : new Suggestion(similar.Value, "memory", similar.Evidence, similar.Score);
    }

    /// <summary>A value as text, or null when it holds nothing.</summary>
    private static string? Answer(JsonElement value) => value.ValueKind switch
    {
        JsonValueKind.String => string.IsNullOrWhiteSpace(value.GetString()) ? null : value.GetString(),
        JsonValueKind.True => "true",
        JsonValueKind.False => "false",
        JsonValueKind.Number => value.GetRawText(),
        JsonValueKind.Array => value.GetArrayLength() == 0 ? null : string.Join(", ", value.EnumerateArray().Select(v => v.ToString())),
        _ => null,
    };
}

/// <summary>
/// A judgment field's similarity threshold: <see cref="Choice"/> is what replaying its history chose, over the
/// <see cref="SelectedAt"/> confirmed documents it had then (null: not yet chosen); <see cref="Confirmed"/> is how
/// many it has now.
/// </summary>
public sealed record FieldThreshold(ThresholdChoice? Choice, int Confirmed, int? SelectedAt)
{
    /// <summary>
    /// The threshold the field answers from similar documents at: the one chosen from its history; the prior
    /// while it has not been chosen yet or the history is too short to choose from; and none — similar
    /// documents are not offered — when the history was long enough and no threshold was right often enough.
    /// </summary>
    public double? Threshold => Choice?.Threshold
        ?? (SelectedAt is not { } at || at - 1 < Suggestions.MinimumAnswered ? Suggestions.PriorThreshold : null);
}
