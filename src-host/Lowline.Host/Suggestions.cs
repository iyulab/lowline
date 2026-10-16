using System.Text.Json;
using Gil;
using Gil.Forms;
using Gil.Memory;

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
/// <see cref="Abstention"/>'s. <see cref="Source"/> is what it rests on: the value settled alongside (<c>key</c>, <c>coarse</c>),
/// or the similar document whose confirmed value it is (<c>memory</c>). A value rests first on values settled alongside ones
/// the document holds — its observed values, and judgments already confirmed in it; a similar document answers only where
/// those settle nothing, and only on a field whose replay showed that layer right often enough over enough answers
/// (<see cref="Suggestions.SimilarMinimumAnswered"/>) — each layer keeps the precision its own replay promises.
/// </summary>
public sealed record Suggestion(string? Value, string Mode, string? Source, string? Reason = null);

/// <summary>What a <see cref="Suggestion"/> is: a value to offer, none, or none because the person turned it down.</summary>
public static class SuggestionMode
{
    /// <summary>A value settled alongside one the document has.</summary>
    public const string Key = "key";

    /// <summary>
    /// The value a similar document confirmed, where no value settled alongside answers — on a field whose replay showed
    /// similar documents right often enough over at least <see cref="Suggestions.SimilarMinimumAnswered"/> answers.
    /// </summary>
    public const string Memory = "memory";

    /// <summary>No value; <see cref="Suggestion.Reason"/> says why.</summary>
    public const string Abstain = "abstain";

    /// <summary>The person turned down this field's suggestion for this document; it is not offered again.</summary>
    public const string Rejected = "rejected";

    /// <summary>
    /// No value, but its class: the leading characters (<see cref="Suggestion.Value"/>) of the values settled alongside one
    /// the document has, kept to the same promise as a value — for a field whose template names its class length.
    /// </summary>
    public const string Coarse = "coarse";
}

/// <summary>Where a suggestion a person decided came from, as events record it.</summary>
public static class SuggestionSource
{
    /// <summary>A value another program wrote into the document as a suggestion (<see cref="DocumentSnapshot.Proposed"/>).</summary>
    public const string Proposed = "proposed";
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

    /// <summary>
    /// The fewest replayed answers the similar documents layer's promise must rest on for a field to be offered its values.
    /// That layer answers the documents values settled alongside could not, and its precision swings far more from field to
    /// field: on public records replayed as the app asks, every field it answered thirty times or more kept the target with an
    /// honest promise, and every field that fell short had fewer.
    /// </summary>
    public const int SimilarMinimumAnswered = 30;

    /// <summary>The document a draft is asked about: it has no saved version to leave out of the evidence.</summary>
    private const string Unsaved = "\u0000unsaved";

    /// <summary>
    /// Each template's memory: every saved document goes into it; asking writes nothing to it. Values settled alongside the
    /// document's other values answer first, once replay has shown they decide the field
    /// (<see cref="FieldDefinition.KeyThreshold"/>); similar documents answer where those settle nothing, on a field whose own
    /// replay of that layer earned it (<see cref="FieldDefinition.MemoryThreshold"/> — see
    /// <see cref="FieldThreshold.SimilarThreshold"/>). Only a template with such a field keeps its documents for similarity
    /// (<see cref="_similar"/>): on a large vault that memory costs as much to build as the rest, and most templates never
    /// earn it.
    /// </summary>
    private Dictionary<string, FormResolver> _resolvers = new(StringComparer.Ordinal);

    /// <summary>The templates whose memory keeps their documents for similarity.</summary>
    private HashSet<string> _similar = new(StringComparer.Ordinal);
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
    /// document means the field was filled in since, and lifts it. Turning down a value another program proposed
    /// (<see cref="SuggestionSource.Proposed"/>) says nothing about what suggestions here would offer.
    /// </summary>
    private static HashSet<(string, string)> Rejected(IReadOnlyList<SuggestionEvent> events) =>
        events
            .Where(e => e.Source != SuggestionSource.Proposed)
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
        var settled = templates.Values.ToDictionary(t => t.Ref, t => documents[t.Ref].Select(d => Settled(t, d)).ToList(), StringComparer.Ordinal);
        var thresholds = new Dictionary<(string, string), FieldThreshold>();
        foreach (var template in templates.Values)
        {
            foreach (var field in template.Suggest!)
            {
                // A value another program proposed is not one a person confirmed.
                var confirmed = settled[template.Ref].Count(d => d.Values.ContainsKey(field) && d.Settlements?.GetValueOrDefault(field) is not SettlementKind.Fill);
                // A threshold chosen while the field had other choices is used until it is chosen again over these:
                // the values it may be suggested are not the ones its replay counted. One resting on a field the template
                // no longer has is no threshold: its strength was chosen on scores those fields gave.
                thresholds[(template.Ref, field)] = kept?.GetValueOrDefault((template.Ref, field)) is { } threshold
                    && threshold.RestsWithin([.. template.Fields.Select(f => f.Name)])
                    ? threshold.ChosenOver(DomainOf(template, field)) && threshold.CoarsePrefix == CoarseOf(template, field)
                        ? threshold with { Confirmed = confirmed }
                        : threshold with { Confirmed = confirmed, SelectedAt = null }
                    : new FieldThreshold(null, confirmed, SelectedAt: null);
            }
        }

        var suggestions = new Suggestions(templates, settled, thresholds, vault.Events ?? []);
        foreach (var template in templates.Values)
        {
            var similar = suggestions.EarnsSimilar(template.Ref);
            suggestions._resolvers[template.Ref] = await suggestions.RememberAsync(template, similar, cancellationToken);
            if (similar) suggestions._similar.Add(template.Ref);
        }
        return suggestions;
    }

    /// <summary>Whether any judgment field of the template is offered similar documents' values.</summary>
    private bool EarnsSimilar(string template) => _templates[template].Suggest!.Any(f => _thresholds[(template, f)].SimilarOffered);

    /// <summary>
    /// A template's memory of its saved documents — kept for similarity too when <paramref name="similar"/>. Memory is kept
    /// for every judgment field; the threshold a field is asked at decides whether it is used.
    /// </summary>
    private async Task<FormResolver> RememberAsync(TemplateSnapshot template, bool similar, CancellationToken cancellationToken)
    {
        var resolver = new FormResolver(new FieldMemory(), similar ? new LexicalMemory() : null);
        await resolver.RebuildAsync(Form(template, _ => new FieldThreshold(null, 0, null))!, _settled[template.Ref], cancellationToken);
        return resolver;
    }

    /// <summary>
    /// Whether a field's threshold should be chosen again: it never was, or the field has gained or lost a
    /// tenth of its confirmed documents since — the right threshold moves as memory grows.
    /// </summary>
    public bool NeedsSelection => _thresholds.Values.Any(Due);

    /// <summary>Whether a judgment field's threshold should be chosen again (see <see cref="NeedsSelection"/>).</summary>
    public bool Due(string template, string field) => _thresholds.GetValueOrDefault((template, field)) is { } threshold && Due(threshold);

    private static bool Due(FieldThreshold t) => t.SelectedAt is not { } at || Math.Abs(t.Confirmed - at) * 10 >= Math.Max(at, 10);

    /// <summary>
    /// Chooses the strength at which each judgment field's values settled alongside the document's other values answer, by
    /// replaying its confirmed documents in the order they were saved — only the fields whose thresholds are due (see
    /// <see cref="Due(string, string)"/>); the rest keep theirs. It runs apart from building memory and its result is applied
    /// with <see cref="ApplyAsync"/>.
    /// </summary>
    public async Task<IReadOnlyDictionary<(string Template, string Field), FieldThreshold>> SelectThresholdsAsync(CancellationToken cancellationToken)
    {
        var chosen = new Dictionary<(string, string), FieldThreshold>();
        foreach (var ((template, field), current) in _thresholds.Where(t => Due(t.Value)).ToList())
        {
            cancellationToken.ThrowIfCancellationRequested();
            var bare = Form(_templates[template], _ => new FieldThreshold(null, 0, 0))!;
            // How far a key seen only a few times is believed, first: a field naming the very thing judged keeps the value
            // its keys were first seen with, a broad one mixes values, and the scores every strength below is chosen on
            // follow from it. Each field's is its own, so choosing them over every field holds for whichever key it.
            var concentrations = ThresholdSelection.SelectKeyConcentrations(new FieldMemory(), bare, field, _settled[template]) is { Count: > 0 } chosenConcentrations
                ? chosenConcentrations
                : null;
            var concentrated = Form(_templates[template], f => new FieldThreshold(null, 0, 0, KeyConcentrations: f == field ? concentrations : null))!;
            // The fields that key the judgment first — where a few decide a field of many values, the rest only add to
            // every value's score — then the strength, replayed with them. A field a person types into is asked again
            // with each character, and the fields that decide it before typing may blur it once a prefix has narrowed its
            // values: its set is counted by the answers before and while typing together, and the strengths for one, two
            // and three characters typed come with it — replayed on the documents the strength before typing did not answer
            // rightly, so each keeps its promise where a person actually types. Null for a field whose value is picked.
            var typeable = Typeable(_templates[template].Fields.First(f => f.Name == field));
            var keyed = ThresholdSelection.SelectKeyFields(
                () => new FieldMemory(), concentrated, field, _settled[template], TargetPrecision, MinimumAnswered,
                typedLongest: typeable ? TypedLongest : 0);
            var key = keyed.Chosen;
            // Similar documents answer only the lookups values settled alongside leave, so their strength is replayed on those,
            // with the fields that key the judgment as just chosen.
            var keying = new FieldThreshold(null, 0, 0, KeyFields: keyed.KeyFields, KeyConcentrations: concentrations);
            var layers = await ThresholdSelection.SelectLayersAsync(
                new FieldMemory(), new LexicalMemory(), Form(_templates[template], f => f == field ? keying : new FieldThreshold(null, 0, 0))!,
                field, _settled[template], TargetPrecision, MinimumAnswered, cancellationToken);
            var threshold = new FieldThreshold(
                key.Chosen, current.Confirmed, current.Confirmed, key.MostPrecise, DomainOf(_templates[template], field),
                keyed.KeyFields, keyed.Typed?.ByLength.Select(r => r.Chosen).ToList(), CoarseOf(_templates[template], field),
                KeyConcentrations: concentrations, Similar: layers.Memory.Chosen);
            // A class is offered where the value is not, so its strength is replayed on the lookups the value's leaves.
            if (threshold.CoarsePrefix is not null)
            {
                var valued = Form(_templates[template], f => f == field ? threshold with { Similar = null } : new FieldThreshold(null, 0, 0))!;
                // A class is offered only from values settled alongside, so the replay keeps no document memory: only its key
                // threshold is read.
                var classed = await ThresholdSelection.SelectCoarseAsync(
                    new FieldMemory(), memory: null, valued, field, _settled[template], TargetPrecision,
                    MinimumAnswered, cancellationToken);
                threshold = threshold with { Coarse = classed.Key.Chosen };
            }
            chosen[(template, field)] = threshold;
        }
        return chosen;
    }

    /// <summary>The most characters typed into a field that suggestions are chosen a strength for.</summary>
    private const int TypedLongest = 3;

    /// <summary>The field types whose value a person types out, rather than picks, checks or enters as a number or date.</summary>
    private static readonly HashSet<string> TypedTypes = new(StringComparer.Ordinal) { "text", "textarea", "email", "tel", "url", "search" };

    /// <summary>Whether a person types a field's value out — one value, of a typed kind, with no choices to pick from.</summary>
    public static bool Typeable(TemplateField field) =>
        !field.Multiple && field.Options is not [_, ..] && TypedTypes.Contains(field.Type);

    /// <summary>
    /// Uses thresholds <see cref="SelectThresholdsAsync"/> chose. A template one of whose fields has just earned similar
    /// documents gets its memory built again to keep them; one whose fields no longer have keeps it until the next build.
    /// </summary>
    public async Task ApplyAsync(IReadOnlyDictionary<(string Template, string Field), FieldThreshold> chosen, CancellationToken cancellationToken)
    {
        // Replaced, not changed in place: a later build may be reading these as its previous thresholds.
        var thresholds = new Dictionary<(string, string), FieldThreshold>(_thresholds);
        foreach (var (key, threshold) in chosen)
        {
            if (thresholds.ContainsKey(key)) thresholds[key] = threshold;
        }
        var earning = _templates.Keys.Where(t => !_similar.Contains(t) && t is var template
            && _templates[template].Suggest!.Any(f => thresholds[(template, f)].SimilarOffered)).ToList();
        var resolvers = new Dictionary<string, FormResolver>(_resolvers, StringComparer.Ordinal);
        foreach (var template in earning)
            resolvers[template] = await RememberAsync(_templates[template], similar: true, cancellationToken);
        (_thresholds, _resolvers, _similar) = (thresholds, resolvers, [.. _similar, .. earning]);
        _forms = Forms();
    }

    /// <summary>Each judgment field's thresholds as they stand, for a later build or launch to keep.</summary>
    public IReadOnlyDictionary<(string Template, string Field), FieldThreshold> Thresholds => _thresholds;

    /// <summary>How a judgment field's key strength was chosen, and how it did on the replay; null until it has been.</summary>
    public ThresholdChoice? Choice(string template, string field) => _thresholds.GetValueOrDefault((template, field))?.Choice;

    /// <summary>
    /// For a field whose value is typed out, how each number of characters typed did on its replay — null where no strength
    /// was right often enough; null for any other field, or until its replay has run.
    /// </summary>
    public IReadOnlyList<ThresholdChoice?>? Typed(string template, string field) =>
        _thresholds.GetValueOrDefault((template, field)) is { SelectedAt: not null, Typed: { } typed } ? typed : null;

    /// <summary>
    /// For a field whose template names a class, how the class did on the lookups its value left and the strength chosen
    /// for it; null until one was, or when none was right often enough.
    /// </summary>
    public ThresholdChoice? CoarseChoice(string template, string field) =>
        _thresholds.GetValueOrDefault((template, field)) is { SelectedAt: not null, Coarse: { } coarse } ? coarse : null;

    /// <summary>
    /// How similar documents did on the lookups values settled alongside left, and the strength chosen for them; null until
    /// one was, or when none was right often enough. They are offered only once <see cref="FieldThreshold.SimilarOffered"/>.
    /// </summary>
    public FieldThreshold? SimilarChoice(string template, string field) =>
        _thresholds.GetValueOrDefault((template, field)) is { SelectedAt: not null, Similar: not null } threshold ? threshold : null;

    /// <summary>The fields the replay chose to key a judgment field; null when every value filled in counts.</summary>
    public IReadOnlyList<string>? KeyFields(string template, string field) =>
        _thresholds.GetValueOrDefault((template, field))?.KeyFields;

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

    /// <summary>
    /// How many leading characters of a field's values name their class, as its template says; null when it says none,
    /// or for a field that takes several values.
    /// </summary>
    private static int? CoarseOf(TemplateSnapshot template, string field) =>
        template.Coarse?.GetValueOrDefault(field) is > 0 and var prefix
        && template.Fields.FirstOrDefault(f => f.Name == field) is { Multiple: false }
            ? prefix
            : null;

    /// <summary>A template as a Gil form, or null when its author turned suggestions on for no field.</summary>
    internal static FormDefinition? Form(TemplateSnapshot template, Func<string, FieldThreshold> threshold)
    {
        var judged = template.Suggest ?? [];
        if (!template.Fields.Any(f => judged.Contains(f.Name))) return null;
        // A judgment rests on the other values the document holds — the observed ones, and judgments the person has
        // already confirmed in it, which often say the most about the rest. Its key layer may count only the few of them
        // its replay chose (KeyFields); the similar document layer still sees them all. A suggestion shown and not taken
        // is no value.
        // A document does not record the order its values came in, so the replay takes the judged ones as confirmed in
        // the form's order: for one confirmed out of that order it counts on more than its suggestion had.
        var fields = template.Fields.Select(f => judged.Contains(f.Name)
            ? new FieldDefinition(f.Name, FieldRole.Judged)
            {
                KeyThreshold = threshold(f.Name).KeyThreshold,
                MemoryThreshold = threshold(f.Name).SimilarThreshold,
                KeyFields = threshold(f.Name).KeyFields,
                KeyConcentrations = threshold(f.Name).KeyConcentrations,
                TypedKeyThresholds = threshold(f.Name).Typed?.Select(c => c?.Threshold).ToList(),
                // A field of one choice is suggested only a choice it has now: a value settled under an option
                // since dropped is remembered, not offered.
                Candidates = DomainOf(f),
                Coarse = CoarseOf(template, f.Name) is { } prefix
                    ? new CoarseLevel(prefix) { KeyThreshold = threshold(f.Name).Coarse?.Threshold }
                    : null,
            }
            : new FieldDefinition(f.Name, FieldRole.Observed));
        // No model is called, so the language is never used.
        return new FormDefinition(template.Ref, [.. fields], PromptLanguage.English);
    }

    /// <summary>
    /// A saved document as Gil sees it: its values as text, settled when the file was last written — the
    /// oldest possible time when that is unknown, as the shell reports an unreadable one. A judgment value another
    /// program proposed is filled in, not settled by a person (<see cref="SettlementKind.Fill"/>): it stays in the
    /// document, and memory neither learns it nor asks about it when choosing thresholds.
    /// </summary>
    internal static SettledDocument Settled(TemplateSnapshot template, DocumentSnapshot document)
    {
        var settled = new SettledDocument(document.Identity, Texts(document.Values), DateTimeOffset.FromUnixTimeMilliseconds(document.Modified ?? 0));
        var filled = (document.Proposed ?? []).Where(f => template.Suggest!.Contains(f)).ToList();
        return filled.Count == 0
            ? settled
            : settled with { Settlements = filled.ToDictionary(f => f, _ => SettlementKind.Fill, StringComparer.Ordinal) };
    }

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
        // Only the field asked about: typing into it changes no other field's suggestion.
        var suggestion = await _resolvers[request.Template].SuggestAsync(
            form, request.Document ?? Unsaved, request.Field, held, sets: null, typing ? request.Typed : null, cancellationToken);

        // Only a layer that keeps its promise is offered: anything else leaves the field to the person. Similar documents
        // were replayed before typing only, so once a person types, the field is left to values settled alongside.
        if (suggestion is { Answered: true, Candidates: [{ Source: FieldSource.SettledFieldMemory } answer, ..] })
            return new Suggestion(answer.Value, SuggestionMode.Key, answer.Evidence);
        if (!typing && suggestion is { Answered: true, Candidates: [{ Source: FieldSource.SimilarDocument } similar, ..] })
            return new Suggestion(similar.Value, SuggestionMode.Memory, similar.Evidence);
        // Where the value is not, its class may be — on the same layer, at the strength its own replay chose.
        if (suggestion?.Coarse is { Trusted: true, Source: FieldSource.SettledFieldMemory } coarse)
            return new Suggestion(coarse.Value, SuggestionMode.Coarse, coarse.Evidence);
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
/// <param name="KeyFields">
/// The fields the replay chose to key the judgment, the strength chosen with them; null for every other field.
/// </param>
/// <param name="Typed">
/// How the field's replay did with one, two, three characters typed, and the strength chosen for each (null where none was
/// right often enough); null for a field whose value is not typed, or not yet chosen.
/// </param>
/// <param name="CoarsePrefix">How many leading characters named the field's class when its thresholds were chosen; null for none.</param>
/// <param name="Coarse">
/// How the class did on the lookups the value left, and the strength chosen for it; null when none was right often enough,
/// or the field has no class.
/// </param>
/// <param name="KeyConcentrations">
/// How readily each field's keys were believed after a few settlements when the strengths were chosen — they set the scale
/// of the scores those strengths are on; null when every field's was the usual one.
/// </param>
/// <param name="Similar">
/// How similar documents did on the lookups values settled alongside left, and the strength chosen for them; null when none
/// was right often enough.
/// </param>
public sealed record FieldThreshold(
    ThresholdChoice? Choice, int Confirmed, int? SelectedAt, ThresholdChoice? Closest = null, IReadOnlyList<string>? Domain = null,
    IReadOnlyList<string>? KeyFields = null, IReadOnlyList<ThresholdChoice?>? Typed = null, int? CoarsePrefix = null,
    ThresholdChoice? Coarse = null, IReadOnlyDictionary<string, double>? KeyConcentrations = null, ThresholdChoice? Similar = null)
{
    /// <summary>Whether it was chosen over the choices <paramref name="domain"/> lists (null: an open value).</summary>
    public bool ChosenOver(IReadOnlyList<string>? domain) =>
        Domain is null ? domain is null : domain is not null && Domain.SequenceEqual(domain, StringComparer.Ordinal);

    /// <summary>Whether every field that keys it is one of <paramref name="fields"/>.</summary>
    public bool RestsWithin(IReadOnlyCollection<string> fields) => (KeyFields ?? []).All(fields.Contains);

    /// <summary>The strength the field's values settled alongside answer at; none — nothing is offered — until one has been chosen.</summary>
    public double? KeyThreshold => Choice?.Threshold;

    /// <summary>
    /// The strength similar documents answer at — none, so they are not offered, until their replay chose one whose promise
    /// rests on at least <see cref="Suggestions.SimilarMinimumAnswered"/> answers.
    /// </summary>
    public double? SimilarThreshold => Similar is { PromiseAnswered: >= Suggestions.SimilarMinimumAnswered } similar ? similar.Threshold : null;

    /// <summary>Whether similar documents are offered for the field (see <see cref="SimilarThreshold"/>).</summary>
    public bool SimilarOffered => SimilarThreshold is not null;
}
