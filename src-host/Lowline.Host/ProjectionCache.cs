using System.Text;
using System.Text.Json.Nodes;
using Formbase.Core;
using Formbase.Core.Primitives;
using Formbase.Core.Projection;
using Formbase.Core.Query;
using Formbase.Core.Schema;
using Formbase.Sqlite;
using Microsoft.Data.Sqlite;

namespace Lowline.Host;

/// <summary>
/// Formbase over one SQLite file outside the vault: each template a form type, each document a record
/// keyed by its vault path. The file is a cache — the vault can always rebuild it — so a file that
/// cannot be read is started over, and an ingest appends only what changed since the file last saw
/// the vault.
/// </summary>
internal sealed class ProjectionCache : IAsyncDisposable
{
    private const int PageSize = 1_000;

    private readonly ServiceProvider _provider;
    private readonly string _connectionString;
    private readonly FormbaseEngine _engine;
    private readonly SqliteFieldHintSource _hints;

    /// <summary>
    /// Per form type, the fingerprint of each live record's latest document — read from the raw store the
    /// first time the type is ingested, then kept in step with what this cache appends and retires.
    /// </summary>
    private readonly Dictionary<string, Dictionary<string, string>> _records = new(StringComparer.Ordinal);

    private ProjectionCache(string connectionString)
    {
        _connectionString = connectionString;
        var services = new ServiceCollection();
        services.AddFormbaseCore();
        services.AddSqliteRawStore(connectionString);
        services.AddSqliteProjection(connectionString);
        _provider = services.BuildServiceProvider();
        _engine = _provider.GetRequiredService<FormbaseEngine>();
        _hints = _provider.GetRequiredService<SqliteFieldHintSource>();
    }

    /// <summary>Opens the cache file, starting it over when it cannot be read.</summary>
    public static async Task<ProjectionCache> OpenAsync(string file, CancellationToken cancellationToken)
    {
        var connectionString = new SqliteConnectionStringBuilder { DataSource = file }.ToString();
        var cache = new ProjectionCache(connectionString);
        try
        {
            // Reading any status creates the file's tables, or fails on a file that is not a database.
            await cache._engine.GetProjectionStatusAsync(FormTypeRef.Create("lowline-cache-check@1"), cancellationToken);
            return cache;
        }
        catch (SqliteException)
        {
            await cache.DisposeAsync();
            Delete(file);
            return new ProjectionCache(connectionString);
        }
    }

    /// <summary>
    /// Brings the file up to this snapshot: new and changed documents are appended as the latest of their
    /// record, records whose document is gone are retired, and a template's table is rebuilt when either
    /// moved it or its fields changed.
    /// </summary>
    public async Task<IngestResult> IngestAsync(VaultSnapshot vault, CancellationToken cancellationToken)
    {
        var skipped = new List<SkippedDocument>();
        var documents = vault.Templates.ToDictionary(
            t => t.Ref, _ => new Dictionary<string, (string Path, JsonObject Body)>(StringComparer.Ordinal), StringComparer.Ordinal);
        foreach (var document in vault.Documents)
        {
            if (!documents.TryGetValue(document.Template, out var ofTemplate))
            {
                skipped.Add(new SkippedDocument(document.Path, $"template {document.Template} is not in the vault"));
                continue;
            }
            var body = new JsonObject { [VaultProjection.PathColumn] = document.Path };
            foreach (var (name, value) in document.Values) body[name] = JsonNode.Parse(value.GetRawText());
            ofTemplate[RecordKeyOf(document.Path).Value] = (document.Path, body);
        }

        int appended = 0, retired = 0;
        var projections = new List<string>();
        foreach (var template in vault.Templates)
        {
            var type = FormTypeRef.Create(template.Ref);
            await _hints.DeclareAsync(new FormTypeHints(
                type,
                TableName(template.Ref),
                [
                    new FieldHint(VaultProjection.PathColumn, ColumnType.Text, Nullable: false),
                    .. template.Fields.Select(f => new FieldHint(f.Name, VaultProjection.ColumnTypeOf(f))),
                ]), cancellationToken);

            var records = await RecordsAsync(type, cancellationToken);
            var present = documents[template.Ref];
            foreach (var (key, (_, body)) in present)
            {
                var fingerprint = Fingerprint(body);
                if (records.TryGetValue(key, out var known) && known == fingerprint) continue;
                await _engine.AcceptAsync(
                    type, DocumentBody.Parse(body.ToJsonString()), recordKey: RecordKey.Create(key), cancellationToken: cancellationToken);
                records[key] = fingerprint;
                appended++;
            }
            foreach (var key in records.Keys.Where(k => !present.ContainsKey(k)).ToList())
            {
                await _engine.RetireAsync(type, RecordKey.Create(key), cancellationToken: cancellationToken);
                records.Remove(key);
                retired++;
            }

            // Stale on either axis: the raw stream moved past the table, or the fields were redeclared.
            var status = await _engine.GetProjectionStatusAsync(type, cancellationToken);
            if (status.State != ProjectionState.Projected
                && (await _engine.ProjectAsync(type, cancellationToken)).Projected)
            {
                projections.Add(template.Ref);
            }
            foreach (var skip in await _engine.GetProjectionSkipsAsync(type, cancellationToken))
            {
                var key = (await _engine.GetDocumentAsync(skip.DocumentId, cancellationToken))?.Key?.Value;
                var path = key is not null && present.TryGetValue(key, out var entry) ? entry.Path : key;
                skipped.Add(new SkippedDocument(path ?? skip.DocumentId.ToString(), skip.Reason));
            }
        }
        return new IngestResult(appended, retired, projections, skipped);
    }

    public async Task<ProjectionTable> TableAsync(TemplateSnapshot template, CancellationToken cancellationToken)
    {
        var result = await _engine.QueryAsync(
            FormTypeRef.Create(template.Ref),
            new QuerySpec(OrderBy: [new OrderKey(VaultProjection.PathColumn, Descending: false)]),
            cancellationToken);
        var columns = template.Fields.Select(f => new ProjectionColumn(f.Name, f.Type)).ToList();
        var rows = result.Rows
            .Select(row => new ProjectionRow(
                (string)row[VaultProjection.PathColumn]!,
                template.Fields.ToDictionary(f => f.Name, f => row.TryGetValue(f.Name, out var v) ? v : null)))
            .ToList();
        return new ProjectionTable(template.Ref, columns, rows);
    }

    /// <summary>
    /// The record a vault path names. Sync clients and file systems spell one path in either Unicode form,
    /// and Formbase compares keys exactly, so the key is the composed form.
    /// </summary>
    public static RecordKey RecordKeyOf(string path) => RecordKey.Create(path.Normalize(NormalizationForm.FormC));

    /// <summary>Removes a cache file and what SQLite keeps beside it.</summary>
    public static void Delete(string file)
    {
        foreach (var path in new[] { file, file + "-wal", file + "-shm", file + "-journal" })
        {
            if (File.Exists(path)) File.Delete(path);
        }
    }

    public async ValueTask DisposeAsync()
    {
        await _provider.DisposeAsync();
        // Pooled connections keep the file open, which on Windows keeps it from being deleted.
        using var connection = new SqliteConnection(_connectionString);
        SqliteConnection.ClearPool(connection);
    }

    /// <summary>The live records of a form type, read from the raw store on first use.</summary>
    private async Task<Dictionary<string, string>> RecordsAsync(FormTypeRef type, CancellationToken cancellationToken)
    {
        var name = type.ToString();
        if (_records.TryGetValue(name, out var records)) return records;
        var stream = new List<StoredDocument>();
        var after = Watermark.Zero;
        while (true)
        {
            var page = await _engine.ReadDocumentsAsync(type, after, PageSize, cancellationToken);
            if (page.Documents.Count == 0) break;
            stream.AddRange(page.Documents);
            after = page.Documents[^1].Watermark;
        }
        records = new Dictionary<string, string>(StringComparer.Ordinal);
        foreach (var document in RecordFold.Latest(stream))
        {
            if (document.IsRetirement || document.Key is not { } key) continue;
            records[key.Value] = Fingerprint(JsonNode.Parse(document.Body!.Root.GetRawText())!);
        }
        _records[name] = records;
        return records;
    }

    /// <summary>A document's content in a form that does not depend on the order of its fields.</summary>
    private static string Fingerprint(JsonNode body) => Canonical(body)!.ToJsonString();

    private static JsonNode? Canonical(JsonNode? node) => node switch
    {
        JsonObject obj => new JsonObject(obj
            .OrderBy(p => p.Key, StringComparer.Ordinal)
            .Select(p => KeyValuePair.Create(p.Key, Canonical(p.Value)))),
        JsonArray array => new JsonArray([.. array.Select(Canonical)]),
        _ => node?.DeepClone(),
    };

    /// <summary>An opaque table name for a template: Formbase never shows it, only needs it unique.</summary>
    private static string TableName(string templateRef) =>
        "t_" + Convert.ToHexString(System.Security.Cryptography.SHA256.HashData(Encoding.UTF8.GetBytes(templateRef)))[..16].ToLowerInvariant();
}
