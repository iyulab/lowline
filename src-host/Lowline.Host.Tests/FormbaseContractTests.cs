using System.Text.Json.Nodes;
using Formbase.Core;
using Formbase.Core.InMemory;
using Formbase.Core.Primitives;
using Formbase.Core.Query;
using Formbase.Core.Schema;
using Microsoft.Extensions.DependencyInjection;

namespace Lowline.Host.Tests;

/// <summary>
/// What the app relies on from Formbase beyond reading a table, checked on the shape the app projects:
/// Korean column names, a path column, judgment fields left empty.
/// </summary>
public sealed class FormbaseContractTests
{
    private static CancellationToken Ct => TestContext.Current.CancellationToken;

    private static async Task<(FormbaseEngine Engine, FormTypeRef Type)> Projected()
    {
        var services = new ServiceCollection();
        services.AddFormbaseInMemory();
        var provider = services.BuildServiceProvider();
        var type = FormTypeRef.Create("intake@1");
        provider.GetRequiredService<InMemoryFieldHintSource>().Declare(new FormTypeHints(type, "intake_1",
        [
            new FieldHint(VaultProjection.PathColumn, ColumnType.Text, Nullable: false),
            new FieldHint("요청", ColumnType.Text),
            new FieldHint("담당", ColumnType.Text),
        ]));
        var engine = provider.GetRequiredService<FormbaseEngine>();
        foreach (var (path, request, owner) in new[]
        {
            ("문서/1.md", "노트북 배터리", "장비"),
            ("문서/2.md", "노트북 화면", "장비"),
            ("문서/3.md", "급여 명세서", (string?)null),
        })
        {
            var body = new JsonObject { [VaultProjection.PathColumn] = path, ["요청"] = request };
            if (owner is not null) body["담당"] = owner;
            await engine.AcceptAsync(type, DocumentBody.Parse(body.ToJsonString()),
                recordKey: RecordKey.Create(path), cancellationToken: Ct);
        }
        await engine.ProjectAsync(type, Ct);
        return (engine, type);
    }

    [Fact]
    public async Task Counts_documents_by_a_judgment_field_with_the_empty_ones_first()
    {
        var (engine, type) = await Projected();
        var result = await engine.AggregateAsync(type, new AggregateSpec(GroupBy: ["담당"]), Ct);
        Assert.Equal([(null, 1L), ("장비", 2L)], result.Groups.Select(g => ((string?)g.Key["담당"], (long)g.Count)));
    }

    [Fact]
    public async Task Finds_the_documents_whose_judgment_field_is_still_empty()
    {
        var (engine, type) = await Projected();
        var result = await engine.QueryAsync(type, new QuerySpec(Filters: [FieldFilter.IsNull("담당")]), Ct);
        Assert.Equal(["문서/3.md"], result.Rows.Select(r => (string)r[VaultProjection.PathColumn]!));
    }

    [Fact]
    public async Task Filters_by_part_of_a_text_field()
    {
        var (engine, type) = await Projected();
        var result = await engine.QueryAsync(type, new QuerySpec(
            Filters: [new FieldFilter("요청", FilterOperator.Contains, "노트북")],
            OrderBy: [new OrderKey(VaultProjection.PathColumn, Descending: false)]), Ct);
        Assert.Equal(["문서/1.md", "문서/2.md"], result.Rows.Select(r => (string)r[VaultProjection.PathColumn]!));
    }

    [Fact]
    public async Task Each_count_carries_the_documents_it_is_made_of_traced_to_their_vault_paths()
    {
        var (engine, type) = await Projected();
        var result = await engine.AggregateAsync(type, new AggregateSpec(GroupBy: ["담당"], DocumentsPerGroup: 10), Ct);
        // A document's record key never changes, so tracing ids read with the count stays true to that count.
        var paths = new List<string?[]>();
        foreach (var group in result.Groups)
        {
            var keys = new List<string?>();
            foreach (var id in group.Documents!)
                keys.Add((await engine.GetDocumentAsync(id, Ct))?.Key?.Value);
            paths.Add([.. keys]);
        }
        Assert.Equal([["문서/3.md"], ["문서/1.md", "문서/2.md"]], paths);
    }

    [Fact]
    public async Task A_capped_group_keeps_the_first_accepted_documents_and_reads_the_rest_by_its_key()
    {
        var (engine, type) = await Projected();
        var spec = new AggregateSpec(GroupBy: ["담당"], DocumentsPerGroup: 1);
        var result = await engine.AggregateAsync(type, spec, Ct);
        var owned = result.Groups[1];
        Assert.Equal((2L, 1), (owned.Count, owned.Documents!.Count));
        Assert.Equal("문서/1.md", (await engine.GetDocumentAsync(owned.Documents[0], Ct))?.Key?.Value);

        var all = await engine.QueryAsync(type, spec.RecordsOf(owned), Ct);
        Assert.Equal(["문서/1.md", "문서/2.md"], all.Rows.Select(r => (string)r[VaultProjection.PathColumn]!));
        var empty = await engine.QueryAsync(type, spec.RecordsOf(result.Groups[0]), Ct);
        Assert.Equal(["문서/3.md"], empty.Rows.Select(r => (string)r[VaultProjection.PathColumn]!));
    }
}
