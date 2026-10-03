using System.Text.Json;
using System.Text.Json.Nodes;

namespace Lowline.Host.Tests;

/// <summary>
/// The vault as the UI hands it over (<c>ui-snapshot.json</c>) and the questions it asks (<c>ui-requests.json</c>, the
/// body of each, by the shell command that hands it on), both written by the UI's own test from its real functions:
/// every field in them is either read here or left out on purpose, said below with why. A field
/// the UI starts to send fails here until it is one or the other — the sidecar once read a choice field
/// without its options, and so suggested values the template no longer offered.
/// </summary>
public sealed class SnapshotContractTests
{
    /// <summary>What the UI sends that the sidecar has no use for, by the kind of object it is in.</summary>
    private static readonly Dictionary<Type, Dictionary<string, string>> LeftOut = new()
    {
        [typeof(TemplateField)] = new()
        {
            ["label"] = "what the form shows; the table and suggestions go by the field's name",
            ["reference"] = "the UI resolves a reference to a name; the sidecar keeps the id it is given",
        },
        [typeof(SuggestionEvent)] = new()
        {
            ["value"] = "what was saved is read from the document itself",
            ["recall"] = "which values a suggestion rested on, for the person; not learned from",
            ["similarity"] = "kept in the event format, always empty since similar records stopped being suggested",
            ["filled"] = "the fill order, for studying the curves; not learned from",
            ["shownAt"] = "timing, for studying the curves; not learned from",
            ["decidedAt"] = "timing, for studying the curves; not learned from",
        },
    };

    /// <summary>The body each shell command hands the sidecar, and what the sidecar reads it as.</summary>
    private static readonly Dictionary<string, Type> Questions = new()
    {
        ["host_suggest"] = typeof(SuggestRequest),
        ["host_search"] = typeof(CaseQuery),
        ["host_similar"] = typeof(SimilarQuery),
        ["host_projection"] = typeof(ProjectionQuery),
    };

    private static JsonObject Read(string file) =>
        JsonNode.Parse(File.ReadAllText(Path.Combine(AppContext.BaseDirectory, file)))!.AsObject();

    private static JsonObject Sent() => Read("ui-snapshot.json");

    private static JsonObject Asked() => Read("ui-requests.json");

    [Fact]
    public void Every_field_the_UI_sends_is_read_or_left_out_on_purpose()
    {
        var sent = Sent();
        var unread = new List<string>();
        void Check(JsonNode? node, Type type, string where)
        {
            if (node is not JsonObject json) return;
            var read = type.GetConstructors().Single().GetParameters().Select(p => p.Name!).ToHashSet(StringComparer.OrdinalIgnoreCase);
            var leftOut = LeftOut.GetValueOrDefault(type) ?? [];
            foreach (var (name, _) in json)
                if (!read.Contains(name) && !leftOut.ContainsKey(name)) unread.Add($"{where}.{name}");
        }

        Check(sent, typeof(VaultSnapshot), "vault");
        foreach (var template in sent["templates"]!.AsArray())
        {
            Check(template, typeof(TemplateSnapshot), "template");
            foreach (var field in template!["fields"]!.AsArray()) Check(field, typeof(TemplateField), "field");
        }
        foreach (var document in sent["documents"]!.AsArray()) Check(document, typeof(DocumentSnapshot), "document");
        foreach (var e in sent["events"]!.AsArray()) Check(e, typeof(SuggestionEvent), "event");

        var asked = Asked();
        Assert.Equal(Questions.Keys.Order(), asked.Select(q => q.Key).Order());
        foreach (var (command, body) in asked)
        {
            Check(body, Questions[command], command);
            // A suggestion's values are the document's, by field name: they are read whole.
            if (body!["filters"] is JsonArray filters)
                foreach (var filter in filters) Check(filter, typeof(ColumnFilter), $"{command}.filter");
        }

        Assert.Empty(unread);
    }

    [Fact]
    public void Nothing_left_out_on_purpose_is_read_after_all()
    {
        foreach (var (type, leftOut) in LeftOut)
        {
            var read = type.GetConstructors().Single().GetParameters().Select(p => p.Name!).ToList();
            foreach (var name in leftOut.Keys)
                Assert.DoesNotContain(read, r => string.Equals(r, name, StringComparison.OrdinalIgnoreCase));
        }
    }

    [Fact]
    public void The_sidecar_reads_it_as_sent()
    {
        var vault = JsonSerializer.Deserialize<VaultSnapshot>(Sent().ToJsonString(), JsonSerializerOptions.Web)!;
        var template = Assert.Single(vault.Templates);
        Assert.Equal("intake@2", template.Ref);
        Assert.Equal(["담당"], template.Suggest);
        Assert.Equal(["장비", "총무"], template.Fields.Single(f => f.Name == "담당").Options);
        Assert.True(template.Fields.Single(f => f.Name == "태그").Multiple);
        var document = Assert.Single(vault.Documents);
        Assert.Equal(("doc-1", "intake@2", 1_790_000_000_000L, true), (document.Identity, document.Template, document.Modified, document.Conflicted));
        Assert.Equal("영업", document.Values["부서"].GetString());
        var e = Assert.Single(vault.Events!);
        Assert.Equal(("doc-1", "담당", "accept", "장비", "intake@2", "key"), (e.Doc, e.Field, e.Kind, e.Suggested, e.Template, e.Source));
    }

    [Fact]
    public void The_sidecar_reads_each_question_as_asked()
    {
        var asked = Asked();
        T Body<T>(string command) => JsonSerializer.Deserialize<T>(asked[command]!.ToJsonString(), JsonSerializerOptions.Web)!;

        var suggest = Body<SuggestRequest>("host_suggest");
        // The saved document it is asked for: a suggestion turned down there is not offered again.
        Assert.Equal(("intake@2", "담당", "doc-1"), (suggest.Template, suggest.Field, suggest.Document));
        Assert.Equal("영업", suggest.Values["부서"].GetString());
        Assert.Equal(("모니터", "intake@2"), (Body<CaseQuery>("host_search").Query, Body<CaseQuery>("host_search").Template));
        Assert.Equal("문서/2026-10-03-모니터.md", Body<SimilarQuery>("host_similar").Path);
        var projection = Body<ProjectionQuery>("host_projection");
        Assert.Equal("intake@2", projection.Template);
        Assert.Equal(new ColumnFilter("부서", "contains", "영업"), Assert.Single(projection.Filters!));
    }
}
