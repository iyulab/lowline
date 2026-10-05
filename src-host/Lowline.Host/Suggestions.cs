using System.Text.Json;
using Gil;
using Gil.Forms;

namespace Lowline.Host;

/// <summary>
/// What the UI asks: a value for one judgment field, given the document's other values.
/// <see cref="Document"/> is the document's <see cref="DocumentSnapshot.Identity"/> once it has been saved. <see cref="Typed"/> is
/// the text a person has typed into the field so far: the field stays open, and only a value that begins with it is offered.
/// </summary>
public sealed record SuggestRequest(
    string Template, string Field, IReadOnlyDictionary<string, JsonElement> Values, string? Document = null, string? Typed = null);

/// <summary>
/// A suggestion for one field. <see cref="Value"/> is null when there is none to make (<c>abstain</c>) —
/// nothing is guessed to fill the gap — and <see cref="Reason"/> then says why, as one of
/// <see cref="Abstention"/>'s. <see cref="Source"/> is the document whose confirmed value it comes from. Every value
/// offered rests on values settled alongside ones the document holds — its observed values, and judgments already
/// confirmed in it (<c>key</c>): only that layer keeps the precision its replay promises. Similar documents are never
/// offered as a suggestion — the person looks at them when they choose to, with the values they confirmed.
/// </summary>
public sealed record Suggestion(string? Value, string Mode, string? Source, string? Reason = null);

/// <summary>What a <see cref="Suggestion"/> is: a value to offer, none, or none because the person turned it down.</summary>
public static class SuggestionMode
{
    /// <summary>A value settled alongside one the document has.</summary>
    public const string Key = "key";

    /// <summary>No value; <see cref="Suggestion.Reason"/> says why.</summary>
    public const string Abstain = "abstain";

    /// <summary>The person turned down this field's suggestion for this document; it is not offered again.</summary>
    public const string Rejected = "rejected";
}

/// <summary>Why a judgment field gets no suggestion — each is said differently, so "none" is never a wrong reason.</summary>
public static class Abstention
{
    /// <summary>No document holding a confirmed value for the field has been saved yet.</summary>
    public const string NoHistory = "no-history";

    /// <summary>
    /// The values settled alongside the document's other values have not yet shown, on a replay of the field's history, that
    /// they are right often enough — too few confirmed, the replay not finished, or none right often enough — so
    /// nothing is offered for the field until they have.
    /// </summary>
    public const string BelowTarget = "below-target";

    /// <summary>The field's values settled alongside have shown they decide it, and this document's other values settle none.</summary>
    public const string Undecided = "undecided";
}

/// <summary>Why a judgment field has no replay to show yet — one of these, or <see cref="Abstention.BelowTarget"/>.</summary>
public static class NoReplay
{
    /// <summary>Its history is too short to choose a strength from; nothing is offered until it is not.</summary>
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
    /// Every saved document goes into its memory; asking writes nothing to it. One layer answers: values settled
    /// alongside the document's other values, once replay has shown they decide the field
    /// (<see cref="FieldDefinition.KeyThreshold"/>). Similar documents are left out — until a form has many thousands
    /// of confirmed documents they are right well below the precision their replay promises, and a form here rarely
    /// has — so no document memory is kept.
    /// </summary>
    private readonly FormResolver _resolver = new(new FieldMemory(), documentMemory: null);
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
    /// Gil keeps the latest confirmation, so the order they come in does not matter. Each judgment field keeps the
    /// thresholds in <paramref name="kept"/> — chosen for it by an earlier build, or kept from an earlier launch — until
    /// <see cref="SelectThresholdsAsync"/> chooses again.
    /// </summary>
    public static async Task<Suggestions> BuildAsync(
        VaultSnapshot vault, CancellationToken cancellationToken,
        IReadOnlyDictionary<(string Template, string Field), FieldThreshold>? kept = null)
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
                // A threshold chosen while the field had other choices is used until it is chosen again over these:
                // the values it may be suggested are not the ones its replay counted. One resting on a field the template
                // no longer has is no threshold: its strength was chosen on scores those fields gave.
                thresholds[(template.Ref, field)] = kept?.GetValueOrDefault((template.Ref, field)) is { } threshold
                    && threshold.RestsWithin([.. template.Fields.Select(f => f.Name)])
                    ? threshold.ChosenOver(DomainOf(template, field))
                        ? threshold with { Confirmed = confirmed }
                        : threshold with { Confirmed = confirmed, SelectedAt = null }
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
    /// Chooses the strength at which each judgment field's values settled alongside the document's other values answer, by
    /// replaying its confirmed documents in the order they were saved. It runs apart from building memory and its
    /// result is applied with <see cref="Apply"/>.
    /// </summary>
    public IReadOnlyDictionary<(string Template, string Field), FieldThreshold> SelectThresholds(CancellationToken cancellationToken)
    {
        var chosen = new Dictionary<(string, string), FieldThreshold>();
        foreach (var ((template, field), current) in _thresholds)
        {
            cancellationToken.ThrowIfCancellationRequested();
            var bare = Form(_templates[template], _ => new FieldThreshold(null, 0, 0))!;
            // The fields the judgment rests on first — where a few decide a field of many values, the rest only add to
            // every value's score — then the strength, replayed with them.
            var resting = ThresholdSelection.SelectDependsOn(
                () => new FieldMemory(), bare, field, _settled[template], TargetPrecision, MinimumAnswered);
            var key = resting.Chosen;
            chosen[(template, field)] = new FieldThreshold(
                key.Chosen, current.Confirmed, current.Confirmed, key.MostPrecise, DomainOf(_templates[template], field),
                resting.DependsOn, TypedThresholds(template, field, key.Chosen, resting.DependsOn));
        }
        return chosen;
    }

    /// <summary>
    /// For a field a person types its value into, the strengths at which values settled alongside answer with one, two and
    /// three characters typed — replayed on the documents the strength chosen without any did not answer rightly, so each
    /// keeps its promise where a person actually types. Chosen with the fields and strength the field is asked with, and
    /// whether or not that strength was found: a field no strength answers on its own may be answered once its first
    /// character narrows it. Null for a field whose value is picked rather than typed.
    /// </summary>
    private IReadOnlyList<double?>? TypedThresholds(
        string template, string field, ThresholdChoice? key, IReadOnlyList<string>? dependsOn)
    {
        if (!Typeable(_templates[template].Fields.First(f => f.Name == field))) return null;
        var asked = Form(_templates[template], f => f == field
            ? new FieldThreshold(key, 0, 0, DependsOn: dependsOn)
            : new FieldThreshold(null, 0, 0))!;
        return ThresholdSelection.SelectTypedKeyThresholds(
            new FieldMemory(), asked, field, _settled[template], TargetPrecision, MinimumAnswered).Thresholds;
    }

    /// <summary>The field types whose value a person types out, rather than picks, checks or enters as a number or date.</summary>
    private static readonly HashSet<string> TypedTypes = new(StringComparer.Ordinal) { "text", "textarea", "email", "tel", "url", "search" };

    /// <summary>Whether a person types a field's value out — one value, of a typed kind, with no choices to pick from.</summary>
    private static bool Typeable(TemplateField field) =>
        !field.Multiple && field.Options is not [_, ..] && TypedTypes.Contains(field.Type);

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

    /// <summary>Each judgment field's thresholds as they stand, for a later build or launch to keep.</summary>
    public IReadOnlyDictionary<(string Template, string Field), FieldThreshold> Thresholds => _thresholds;

    /// <summary>How a judgment field's key strength was chosen, and how it did on the replay; null until it has been.</summary>
    public ThresholdChoice? Choice(string template, string field) => _thresholds.GetValueOrDefault((template, field))?.Choice;

    /// <summary>The fields the replay chose for a judgment field to rest on; null when every value filled in counts.</summary>
    public IReadOnlyList<string>? DependsOn(string template, string field) =>
        _thresholds.GetValueOrDefault((template, field))?.DependsOn;

    /// <summary>
    /// For a field whose replay chose no strength, the closest it came: the most precise strength that still gathered
    /// enough answers. Null when one was chosen, or when the replay found too few candidates to say.
    /// </summary>
    public ThresholdChoice? Closest(string template, string field) =>
        _thresholds.GetValueOrDefault((template, field)) is { Choice: null } threshold ? threshold.Closest : null;

    private Dictionary<string, FormDefinition> Forms() => _templates.Values.ToDictionary(
        t => t.Ref,
        t => Form(t, field => _thresholds[(t.Ref, field)])!,
        StringComparer.Ordinal);

    /// <summary>The choices a field's value is one of — a field of one choice with options — or null when its value is open.</summary>
    private static IReadOnlyList<string>? DomainOf(TemplateField field) =>
        field is { Multiple: false, Options: [_, ..] options } ? options : null;

    private static IReadOnlyList<string>? DomainOf(TemplateSnapshot template, string field) =>
        template.Fields.FirstOrDefault(f => f.Name == field) is { } f ? DomainOf(f) : null;

    /// <summary>A template as a Gil form, or null when its author turned suggestions on for no field.</summary>
    private static FormDefinition? Form(TemplateSnapshot template, Func<string, FieldThreshold> threshold)
    {
        var judged = template.Suggest ?? [];
        if (!template.Fields.Any(f => judged.Contains(f.Name))) return null;
        // A judgment rests on the other values the document holds — the observed ones, and judgments the person has
        // already confirmed in it, which often say the most about the rest — or on the few of them its replay chose
        // (DependsOn). A suggestion shown and not taken is no value.
        // A document does not record the order its values came in, so the replay takes the judged ones as confirmed in
        // the form's order: for one confirmed out of that order it counts on more than its suggestion had.
        var fields = template.Fields.Select(f => judged.Contains(f.Name)
            ? new FieldDefinition(f.Name, FieldRole.Judged)
            {
                KeyThreshold = threshold(f.Name).KeyThreshold,
                DependsOn = threshold(f.Name).DependsOn,
                TypedKeyThresholds = threshold(f.Name).Typed,
                // A field of one choice is suggested only a choice it has now: a value settled under an option
                // since dropped is remembered, not offered.
                Candidates = DomainOf(f),
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
            return new Suggestion(null, SuggestionMode.Rejected, null, null);

        // A judgment rests on the values the document holds now — filled in, or taken from a suggestion — other than its
        // own; the document's saved version is never its evidence.
        var held = Texts(request.Values)
            .Where(v => v.Key != request.Field && form.Fields.Any(f => f.Name == v.Key))
            .ToDictionary(v => v.Key, v => v.Value, StringComparer.Ordinal);
        // Text being typed keeps the field open: only values that begin with it, at the strength chosen for that many
        // characters. Typing is only into a field whose value is typed out; anywhere else it is no question.
        var typing = !string.IsNullOrEmpty(request.Typed);
        if (typing && !Typeable(_templates[request.Template].Fields.First(f => f.Name == request.Field)))
            return Abstain(request.Template, request.Field);
        var asked = typing
            ? await _resolver.SuggestAsync(
                form, request.Document ?? Unsaved, held, new Dictionary<string, IReadOnlyList<string>>(),
                new Dictionary<string, string> { [request.Field] = request.Typed! }, cancellationToken)
            : await _resolver.SuggestAsync(form, request.Document ?? Unsaved, held, cancellationToken);
        var suggestion = asked.SingleOrDefault(s => s.Field == request.Field);

        // Only the layer that keeps its promise is offered: anything else leaves the field to the person.
        if (suggestion is { Answered: true, Candidates: [{ Source: FieldSource.SettledFieldMemory } answer, ..] })
            return new Suggestion(answer.Value, SuggestionMode.Key, answer.Evidence);
        return Abstain(request.Template, request.Field);
    }

    /// <summary>
    /// No value, with why: nothing confirmed yet, the values settled alongside not yet shown right often enough, or
    /// none settled by this document's other values.
    /// </summary>
    private Suggestion Abstain(string template, string field)
    {
        var threshold = _thresholds[(template, field)];
        var reason = threshold.Confirmed == 0 ? Abstention.NoHistory
            : threshold.KeyThreshold is null ? Abstention.BelowTarget
            : Abstention.Undecided;
        return new Suggestion(null, SuggestionMode.Abstain, null, reason);
    }

    /// <summary>
    /// Why a judgment field has no replay to show, as one of <see cref="NoReplay"/>'s or
    /// <see cref="Abstention.BelowTarget"/>; null once its threshold has been chosen.
    /// </summary>
    public string? WhyNoReplay(string template, string field) => _thresholds.GetValueOrDefault((template, field)) switch
    {
        null or { Choice: not null } => null,
        { SelectedAt: { } at } when at - 1 >= MinimumAnswered => Abstention.BelowTarget,
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
/// A judgment field's key strength: <see cref="Choice"/> is the strength at which values settled alongside the
/// document's other values answer, as replaying its history chose it over the <see cref="SelectedAt"/> confirmed documents it had then
/// (null: not yet chosen, or none was right often enough); <see cref="Confirmed"/> is how many it has now.
/// <see cref="Closest"/> is the strength that came closest to the target, chosen or not.
/// </summary>
/// <param name="Domain">The choices the field had when its threshold was chosen; null for a field whose value is open.</param>
/// <param name="DependsOn">
/// The fields the replay chose for the judgment to rest on, the strength chosen with them; null for every other field.
/// </param>
/// <param name="Typed">
/// The strengths for one, two, three characters typed into the field (null where none was right often enough); null for a
/// field whose value is not typed, or not yet chosen.
/// </param>
public sealed record FieldThreshold(
    ThresholdChoice? Choice, int Confirmed, int? SelectedAt, ThresholdChoice? Closest = null, IReadOnlyList<string>? Domain = null,
    IReadOnlyList<string>? DependsOn = null, IReadOnlyList<double?>? Typed = null)
{
    /// <summary>Whether it was chosen over the choices <paramref name="domain"/> lists (null: an open value).</summary>
    public bool ChosenOver(IReadOnlyList<string>? domain) =>
        Domain is null ? domain is null : domain is not null && Domain.SequenceEqual(domain, StringComparer.Ordinal);

    /// <summary>Whether every field it rests on is one of <paramref name="fields"/>.</summary>
    public bool RestsWithin(IReadOnlyCollection<string> fields) => (DependsOn ?? []).All(fields.Contains);

    /// <summary>The strength the field's values settled alongside answer at; none — nothing is offered — until one has been chosen.</summary>
    public double? KeyThreshold => Choice?.Threshold;
}
