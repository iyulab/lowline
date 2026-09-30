using System.Text.Json;
using Gil;
using Gil.Forms;
using Gil.Memory;

namespace Lowline.Host;

/// <summary>
/// What the UI asks: a value for one judgment field, given the document's other values.
/// <see cref="Document"/> is the document's <see cref="DocumentSnapshot.Identity"/> once it has been saved.
/// </summary>
public sealed record SuggestRequest(
    string Template, string Field, IReadOnlyDictionary<string, JsonElement> Values, string? Document = null);

/// <summary>
/// A suggestion for one field. <see cref="Value"/> is null when there is none to make (<c>abstain</c>) —
/// nothing is guessed to fill the gap — and <see cref="Reason"/> then says why, as one of
/// <see cref="Abstention"/>'s. <see cref="Source"/> is the document whose confirmed value it comes from, and
/// <see cref="Similarity"/> how close that document's other values are. A suggestion from similar documents also
/// carries <see cref="Similar"/>: the most similar confirmed documents the lookup found, <see cref="Source"/>'s first,
/// with the value each confirmed — the evidence as it is, other values included. The value offered is still one.
/// </summary>
public sealed record Suggestion(
    string? Value, string Mode, string? Source, double? Similarity, string? Reason = null, IReadOnlyList<SimilarCase>? Similar = null);

/// <summary>A confirmed document like the one asked about: its id, how close it is, and the value it confirmed.</summary>
public sealed record SimilarCase(string Source, double Similarity, string? Value);

/// <summary>Why a judgment field gets no suggestion — each is said differently, so "none" is never a wrong reason.</summary>
public static class Abstention
{
    /// <summary>No document holding a confirmed value for the field has been saved yet.</summary>
    public const string NoHistory = "no-history";

    /// <summary>The field answers from similar documents, and none of those confirmed is close enough to this one.</summary>
    public const string NoneClose = "none-close";

    /// <summary>
    /// Replaying the field's history found no similarity at which its answers were right often enough, so similar
    /// documents are not offered for it at all until more are confirmed.
    /// </summary>
    public const string BelowTarget = "below-target";
}

/// <summary>Why a judgment field has no replay to show yet — one of these, or <see cref="Abstention.BelowTarget"/>.</summary>
public static class NoReplay
{
    /// <summary>Its history is too short to choose a threshold from; the prior threshold serves.</summary>
    public const string Few = "few";

    /// <summary>Its history is long enough, and the replay that chooses its threshold has not finished yet.</summary>
    public const string Pending = "pending";
}

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

    /// <summary>The document a draft is asked about: it has no saved version to leave out of the evidence.</summary>
    private const string Unsaved = "\u0000unsaved";

    /// <summary>
    /// Every saved document goes into its memories; asking writes nothing to them. Two layers answer: values
    /// settled alongside the document's observed values, once replay has shown they decide the field
    /// (<see cref="FieldDefinition.KeyThreshold"/>), and similar documents at the field's similarity threshold.
    /// </summary>
    private readonly FormResolver _resolver = new(new FieldMemory(), new LexicalMemory(), similarDocumentCount: SimilarCount);

    /// <summary>How many similar confirmed documents a suggestion from similar documents shows as its evidence.</summary>
    public const int SimilarCount = 3;
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
            var remembering = Form(template, _ => new FieldThreshold(null, 0, null))!;
            await suggestions._resolver.RebuildAsync(remembering, settled[template.Ref], cancellationToken);
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
    /// Chooses each judgment field's thresholds — similar documents', and the values settled alongside its
    /// observed values' — by replaying its confirmed documents in the order they were saved. The replay grows
    /// with the square of the history, so it runs apart from building memory and its result is applied with
    /// <see cref="Apply"/>.
    /// </summary>
    public async Task<IReadOnlyDictionary<(string Template, string Field), FieldThreshold>> SelectThresholdsAsync(CancellationToken cancellationToken)
    {
        var chosen = new Dictionary<(string, string), FieldThreshold>();
        foreach (var ((template, field), current) in _thresholds)
        {
            var bare = Form(_templates[template], _ => new FieldThreshold(null, 0, 0))!;
            var choice = await ThresholdSelection.SelectAsync(
                new LexicalMemory(), bare, field, _settled[template], TargetPrecision, MinimumAnswered, cancellationToken);
            var key = ThresholdSelection.SelectKeyThreshold(
                new FieldMemory(), bare, field, _settled[template], TargetPrecision, MinimumAnswered);
            chosen[(template, field)] = new FieldThreshold(choice, current.Confirmed, current.Confirmed, key);
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
        t => Form(t, field => _thresholds[(t.Ref, field)])!,
        StringComparer.Ordinal);

    /// <summary>A template as a Gil form, or null when its author turned suggestions on for no field.</summary>
    private static FormDefinition? Form(TemplateSnapshot template, Func<string, FieldThreshold> threshold)
    {
        var judged = template.Suggest ?? [];
        if (!template.Fields.Any(f => judged.Contains(f.Name))) return null;
        // A judgment rests on the fields people fill in, not on other judgments: those are suggested too.
        var observed = template.Fields.Where(f => !judged.Contains(f.Name)).Select(f => f.Name).ToList();
        var fields = template.Fields.Select(f => judged.Contains(f.Name)
            ? new FieldDefinition(f.Name, FieldRole.Judged)
            {
                MemoryThreshold = threshold(f.Name).Threshold,
                KeyThreshold = threshold(f.Name).KeyThreshold,
                DependsOn = observed,
            }
            : new FieldDefinition(f.Name, FieldRole.Observed));
        // No model is called, so the language is never used.
        return new FormDefinition(template.Ref, [.. fields], PromptLanguage.English);
    }

    /// <summary>
    /// A saved document as Gil sees it: its values as text, settled when the file was last written — the
    /// oldest possible time when that is unknown, as the shell reports an unreadable one.
    /// </summary>
    private static SettledDocument Settled(DocumentSnapshot document) => new(
        document.Identity,
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

        // A judgment rests on the fields people fill in; the document's own saved version is never its evidence.
        var observed = Texts(request.Values)
            .Where(v => form.Fields.Any(f => f.Name == v.Key && f.Role == FieldRole.Observed))
            .ToDictionary(v => v.Key, v => v.Value, StringComparer.Ordinal);
        var suggestion = (await _resolver.SuggestAsync(form, request.Document ?? Unsaved, observed, cancellationToken))
            .SingleOrDefault(s => s.Field == request.Field);

        // Only a layer that answered is offered: a guess leaves the field to the person.
        if (suggestion is not { Answered: true }) return Abstain(request.Template, request.Field);
        var answer = suggestion.Candidates[0];
        // The documents shown as similar are the ones as close as the field's threshold asks — the bar the value
        // offered passed — not every document the lookup ranked.
        var threshold = _thresholds[(request.Template, request.Field)].Threshold ?? double.PositiveInfinity;
        return answer.Source switch
        {
            FieldSource.SimilarDocument => new Suggestion(answer.Value, "memory", answer.Evidence, answer.Score,
                Similar: [.. suggestion.SimilarDocuments
                    .Where(m => m.Similarity >= threshold)
                    .Select(m => new SimilarCase(m.Source, m.Similarity, m.Answer))]),
            FieldSource.SettledFieldMemory => new Suggestion(answer.Value, "key", answer.Evidence, null),
            _ => Abstain(request.Template, request.Field),
        };
    }

    /// <summary>No value, with why: nothing confirmed yet, the field held back by its replay, or nothing close enough.</summary>
    private Suggestion Abstain(string template, string field)
    {
        var threshold = _thresholds[(template, field)];
        var reason = threshold.Confirmed == 0 ? Abstention.NoHistory
            : threshold.Threshold is null ? Abstention.BelowTarget
            : Abstention.NoneClose;
        return new Suggestion(null, "abstain", null, null, reason);
    }

    /// <summary>
    /// Why a judgment field has no replay to show, as one of <see cref="NoReplay"/>'s or
    /// <see cref="Abstention.BelowTarget"/>; null once its threshold has been chosen.
    /// </summary>
    public string? WhyNoReplay(string template, string field) => _thresholds.GetValueOrDefault((template, field)) switch
    {
        null or { Choice: not null } => null,
        { Threshold: null } => Abstention.BelowTarget,
        { Confirmed: var confirmed } when confirmed - 1 < MinimumAnswered => NoReplay.Few,
        _ => NoReplay.Pending,
    };

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
/// A judgment field's thresholds: <see cref="Choice"/> is the similarity threshold replaying its history chose and
/// <see cref="KeyChoice"/> the strength at which values settled alongside its observed values answer, over the
/// <see cref="SelectedAt"/> confirmed documents it had then (null: not yet chosen); <see cref="Confirmed"/> is how
/// many it has now.
/// </summary>
public sealed record FieldThreshold(ThresholdChoice? Choice, int Confirmed, int? SelectedAt, ThresholdChoice? KeyChoice = null)
{
    /// <summary>
    /// The strength at which values settled alongside the observed values answer: the one chosen from the field's
    /// history, and none — they are guesses, after similar documents — until one has been, or when none was right
    /// often enough.
    /// </summary>
    public double? KeyThreshold => KeyChoice?.Threshold;

    /// <summary>
    /// The threshold the field answers from similar documents at: the one chosen from its history; the prior
    /// while it has not been chosen yet or the history is too short to choose from; and none — similar
    /// documents are not offered — when the history was long enough and no threshold was right often enough.
    /// </summary>
    public double? Threshold => Choice?.Threshold
        ?? (SelectedAt is not { } at || at - 1 < Suggestions.MinimumAnswered ? Suggestions.PriorThreshold : null);
}
