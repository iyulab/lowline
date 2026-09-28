using System.Text;
using System.Text.Json;
using Gil;
using Gil.Fallback;
using Gil.Memory;
using Gil.Ontology;

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
/// Each template's judgment field is a Gil task; a saved document is a confirmed answer to it:
/// its other fields are the request, the field's value the answer. Documents say what the answer is;
/// events say which suggestions were wrong — a field whose suggestion was last rejected in a
/// document is not offered there again.
/// </summary>
public sealed class Suggestions
{
    /// <summary>
    /// Similarity at which a remembered answer is offered.
    /// TODO(upstream: docket iyulab/Gil#534) — fixed for now; the right value moves with memory size
    /// and should be chosen by replaying the vault's history once the field-level surface exists.
    /// </summary>
    public const double MemoryThreshold = 0.6;

    private static readonly Node Bare = OntologyYaml.Parse("id: root").Root;

    private readonly LexicalMemory _memory = new();
    private readonly Resolver _resolver;
    private readonly Dictionary<string, TemplateSnapshot> _templates;
    private readonly HashSet<(string Doc, string Field)> _rejected;

    private Suggestions(IReadOnlyList<TemplateSnapshot> templates, IReadOnlyList<SuggestionEvent> events)
    {
        _resolver = new Resolver(_memory);
        _templates = templates.ToDictionary(t => t.Ref, StringComparer.Ordinal);
        _rejected = Rejected(events);
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
    /// Remembers the judgment values the vault's documents hold. The same field is answered by its
    /// latest confirmation: documents are taken newest first, and a case already answered by a newer
    /// document is not remembered again — its older answer was corrected since.
    /// TODO(upstream: docket iyulab/Gil#534) — recency is the memory's rule to own: settled documents
    /// with a confirmation time, rebuilt in any order. Remove this ordering once that surface is used.
    /// </summary>
    public static async Task<Suggestions> BuildAsync(VaultSnapshot vault, CancellationToken cancellationToken)
    {
        var suggestions = new Suggestions(vault.Templates, vault.Events ?? []);
        var answered = new HashSet<(string Task, string Request)>();
        var newestFirst = vault.Documents
            .OrderByDescending(d => d.Modified ?? long.MinValue)
            .ThenBy(d => d.Path, StringComparer.Ordinal);
        foreach (var document in newestFirst)
        {
            if (!suggestions._templates.TryGetValue(document.Template, out var template)) continue;
            foreach (var field in template.Suggest ?? [])
            {
                if (!document.Values.TryGetValue(field, out var value) || Answer(value) is not { } answer) continue;
                var task = TaskId(template.Ref, field);
                var request = Request(template, field, document.Values);
                if (!answered.Add((task, request))) continue;
                await suggestions._memory.RememberAsync(task, document.Path, request, answer, document.Path, cancellationToken);
            }
        }
        return suggestions;
    }

    /// <summary>How many confirmed values memory holds for a field.</summary>
    public int Remembered(string template, string field) => _memory.Count(TaskId(template, field));

    public async Task<Suggestion?> SuggestAsync(SuggestRequest request, CancellationToken cancellationToken)
    {
        if (!_templates.TryGetValue(request.Template, out var template)) return null;
        if (template.Suggest?.Contains(request.Field) != true) return null;
        if (request.Document is { } document && _rejected.Contains((document, request.Field)))
            return new Suggestion(null, "rejected", null, null);
        var text = Request(template, request.Field, request.Values);
        if (text.Length == 0) return new Suggestion(null, "abstain", null, null);

        var task = new TaskDefinition(
            TaskId(template.Ref, request.Field),
            new TextContract(),
            Bare,
            new TaskPolicy { Thresholds = new([1.0], 1.0), MemoryThreshold = MemoryThreshold },
            PromptLanguage.English); // the tree is bare and no model is called; the language is never used
        var resolution = await _resolver.ResolveAsync(task, text, cancellationToken: cancellationToken);
        return new Suggestion(
            resolution.Mode == "memory" ? resolution.Output : null,
            resolution.Mode,
            resolution.Recall?.Hit == true ? resolution.Recall.Source : null,
            resolution.Recall?.Similarity);
    }

    private static string TaskId(string template, string field) => $"{template}#{field}";

    /// <summary>
    /// The request for a judgment field: every other field that is not itself a judgment field and
    /// has a value, one "name: value" line each, in template order.
    /// </summary>
    public static string Request(TemplateSnapshot template, string field, IReadOnlyDictionary<string, JsonElement> values)
    {
        var judged = template.Suggest ?? [];
        var text = new StringBuilder();
        foreach (var f in template.Fields)
        {
            if (f.Name == field || judged.Contains(f.Name)) continue;
            if (!values.TryGetValue(f.Name, out var value) || Answer(value) is not { } shown) continue;
            text.Append(f.Name).Append(": ").Append(shown).Append('\n');
        }
        return text.ToString().TrimEnd('\n');
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
