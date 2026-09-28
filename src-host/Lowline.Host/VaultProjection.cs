using System.Text.Json;
using System.Text.Json.Nodes;
using Formbase.Core;
using Formbase.Core.InMemory;
using Formbase.Core.Primitives;
using Formbase.Core.Query;
using Formbase.Core.Schema;

namespace Lowline.Host;

/// <summary>A field of a template, as the UI's Formdown parser reports it.</summary>
public sealed record TemplateField(string Name, string Type, bool Multiple = false);

/// <summary>
/// A template: its `id@version`, its fields in template order, and the judgment fields its author
/// turned suggestions on for (none unless named).
/// </summary>
public sealed record TemplateSnapshot(string Ref, IReadOnlyList<TemplateField> Fields, IReadOnlyList<string>? Suggest = null);

/// <summary>A document: where it lives in the vault, its template, and its recorded values.</summary>
public sealed record DocumentSnapshot(string Path, string Template, IReadOnlyDictionary<string, JsonElement> Values);

/// <summary>
/// What a person did with a suggestion (<c>accept</c>, <c>correct</c> or <c>reject</c>), read from the
/// vault's event files. <see cref="Doc"/> is the document's vault path, <see cref="Template"/> its
/// template (absent in events recorded before it was written down).
/// </summary>
public sealed record SuggestionEvent(string At, string Doc, string Field, string Kind, string Suggested, string? Template = null);

/// <summary>
/// Everything the sidecar knows about a vault: what the shell read and the UI parsed — templates,
/// documents, and what people did with suggestions.
/// </summary>
public sealed record VaultSnapshot(
    IReadOnlyList<TemplateSnapshot> Templates,
    IReadOnlyList<DocumentSnapshot> Documents,
    IReadOnlyList<SuggestionEvent>? Events = null);

public sealed record IngestResult(int Ingested, IReadOnlyList<string> Projections, IReadOnlyList<SkippedDocument> Skipped);

public sealed record SkippedDocument(string Path, string Reason);

public sealed record ProjectionColumn(string Name, string Type);

/// <summary>A template's documents as a table: one row per document, keyed by its vault path.</summary>
public sealed record ProjectionTable(string Template, IReadOnlyList<ProjectionColumn> Columns, IReadOnlyList<ProjectionRow> Rows);

public sealed record ProjectionRow(string Path, IReadOnlyDictionary<string, object?> Values);

/// <summary>
/// The vault projected through Formbase: each template a form type, each document a record.
/// </summary>
public sealed class VaultProjection
{
    /// <summary>The column that carries a document's vault path. `$` cannot start a Formdown field name.</summary>
    public const string PathColumn = "$path";

    private readonly SemaphoreSlim _gate = new(1, 1);
    private Snapshot? _current;
    private Suggestions? _suggestions;
    private IReadOnlyList<FieldCurve> _curves = [];

    public bool Indexed => _current is not null;

    /// <summary>Whether suggestions have been built from the vault's confirmed values.</summary>
    public bool MemoryReady => _suggestions is not null;

    /// <summary>
    /// Replaces what the sidecar knows with this snapshot.
    /// </summary>
    /// <remarks>
    /// TODO(upstream: docket iyulab/Formbase#542) — Formbase cannot yet say that an append corrects an
    /// earlier record, so a changed document would project as a second row. Until it can, every
    /// snapshot rebuilds an in-memory engine with one append per file. The vault is the source and the
    /// raw store a cache of it, so this is exact at L0; it gives up raw history and incremental
    /// projection, which L1 needs.
    /// </remarks>
    public async Task<IngestResult> IngestAsync(VaultSnapshot vault, CancellationToken cancellationToken)
    {
        var snapshot = await Snapshot.BuildAsync(vault, cancellationToken);
        var suggestions = await Suggestions.BuildAsync(vault, cancellationToken);
        var curves = Curves.Compute(vault);
        await _gate.WaitAsync(cancellationToken);
        try
        {
            var previous = _current;
            _current = snapshot;
            _suggestions = suggestions;
            _curves = curves;
            if (previous is not null) await previous.DisposeAsync();
        }
        finally
        {
            _gate.Release();
        }
        return snapshot.Result;
    }

    /// <summary>The table for one template, or null when the vault has no such template.</summary>
    public async Task<ProjectionTable?> TableAsync(string template, CancellationToken cancellationToken)
    {
        await _gate.WaitAsync(cancellationToken);
        try
        {
            return _current is null ? null : await _current.TableAsync(template, cancellationToken);
        }
        finally
        {
            _gate.Release();
        }
    }

    /// <summary>The correction curve of every judgment field that has had a suggestion decided.</summary>
    public async Task<IReadOnlyList<FieldCurve>> CurvesAsync(CancellationToken cancellationToken)
    {
        await _gate.WaitAsync(cancellationToken);
        try
        {
            return _curves;
        }
        finally
        {
            _gate.Release();
        }
    }

    /// <summary>A suggestion for a judgment field, or null when the template has no such judgment field.</summary>
    public async Task<Suggestion?> SuggestAsync(SuggestRequest request, CancellationToken cancellationToken)
    {
        await _gate.WaitAsync(cancellationToken);
        try
        {
            return _suggestions is null ? null : await _suggestions.SuggestAsync(request, cancellationToken);
        }
        finally
        {
            _gate.Release();
        }
    }

    /// <summary>The Formbase column type for a Formdown field.</summary>
    public static ColumnType ColumnTypeOf(TemplateField field) => field.Type switch
    {
        "checkbox" when field.Multiple => ColumnType.Jsonb,
        "checkbox" => ColumnType.Boolean,
        "number" or "range" => ColumnType.Decimal,
        _ => ColumnType.Text,
    };

    private sealed class Snapshot : IAsyncDisposable
    {
        private readonly ServiceProvider _provider;
        private readonly FormbaseEngine _engine;
        private readonly Dictionary<string, TemplateSnapshot> _templates;

        public IngestResult Result { get; private set; } = new(0, [], []);

        private Snapshot(ServiceProvider provider, Dictionary<string, TemplateSnapshot> templates)
        {
            _provider = provider;
            _engine = provider.GetRequiredService<FormbaseEngine>();
            _templates = templates;
        }

        public static async Task<Snapshot> BuildAsync(VaultSnapshot vault, CancellationToken cancellationToken)
        {
            var services = new ServiceCollection();
            services.AddFormbaseInMemory();
            var templates = vault.Templates.ToDictionary(t => t.Ref, StringComparer.Ordinal);
            var snapshot = new Snapshot(services.BuildServiceProvider(), templates);

            var hints = snapshot._provider.GetRequiredService<InMemoryFieldHintSource>();
            foreach (var template in vault.Templates)
            {
                hints.Declare(new FormTypeHints(
                    FormTypeRef.Create(template.Ref),
                    TableName(template.Ref),
                    [
                        new FieldHint(PathColumn, ColumnType.Text, Nullable: false),
                        .. template.Fields.Select(f => new FieldHint(f.Name, ColumnTypeOf(f))),
                    ]));
            }

            var skipped = new List<SkippedDocument>();
            var ingested = 0;
            foreach (var document in vault.Documents)
            {
                if (!templates.ContainsKey(document.Template))
                {
                    skipped.Add(new SkippedDocument(document.Path, $"template {document.Template} is not in the vault"));
                    continue;
                }
                var body = new JsonObject { [PathColumn] = document.Path };
                foreach (var (name, value) in document.Values) body[name] = JsonNode.Parse(value.GetRawText());
                await snapshot._engine.AcceptAsync(
                    FormTypeRef.Create(document.Template),
                    DocumentBody.Parse(body.ToJsonString()),
                    cancellationToken: cancellationToken);
                ingested++;
            }

            var projections = new List<string>();
            foreach (var template in vault.Templates)
            {
                var result = await snapshot._engine.ProjectAsync(FormTypeRef.Create(template.Ref), cancellationToken);
                if (result.Projected) projections.Add(template.Ref);
                foreach (var skip in result.Skipped)
                {
                    var stored = await snapshot._engine.GetDocumentAsync(skip.DocumentId, cancellationToken);
                    var path = stored?.Body.Root.TryGetProperty(PathColumn, out var p) == true ? p.GetString() : null;
                    skipped.Add(new SkippedDocument(path ?? skip.DocumentId.ToString(), skip.Reason));
                }
            }

            snapshot.Result = new IngestResult(ingested, projections, skipped);
            return snapshot;
        }

        public async Task<ProjectionTable?> TableAsync(string template, CancellationToken cancellationToken)
        {
            if (!_templates.TryGetValue(template, out var snapshot)) return null;
            var result = await _engine.QueryAsync(
                FormTypeRef.Create(template),
                new QuerySpec(OrderBy: [new OrderKey(PathColumn, Descending: false)]),
                cancellationToken);
            var columns = snapshot.Fields.Select(f => new ProjectionColumn(f.Name, f.Type)).ToList();
            var rows = result.Rows
                .Select(row => new ProjectionRow(
                    (string)row[PathColumn]!,
                    snapshot.Fields.ToDictionary(f => f.Name, f => row.TryGetValue(f.Name, out var v) ? v : null)))
                .ToList();
            return new ProjectionTable(template, columns, rows);
        }

        public ValueTask DisposeAsync() => _provider.DisposeAsync();

        /// <summary>An opaque table name for a template: Formbase never shows it, only needs it unique.</summary>
        private static string TableName(string templateRef) =>
            "t_" + Convert.ToHexString(System.Security.Cryptography.SHA256.HashData(System.Text.Encoding.UTF8.GetBytes(templateRef)))[..16].ToLowerInvariant();
    }
}
