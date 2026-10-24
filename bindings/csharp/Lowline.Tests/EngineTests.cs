using System.Text.Json.Nodes;
using AwesomeAssertions;

namespace Lowline.Tests;

/// <summary>A host's round through the binding: start from stored records, choose thresholds, show a suggestion, settle
/// a save, start again from storage and answer the same.</summary>
public sealed class EngineTests
{
    internal const string Intake = """
        {
          "name": "intake",
          "form": { "fields": [
            { "name": "customer", "kind": "text" },
            { "name": "owner", "kind": "choice", "choices": ["kim", "lee"] }
          ] }
        }
        """;

    internal static readonly DateTimeOffset Start = new(2026, 1, 1, 0, 0, 0, TimeSpan.Zero);

    /// <summary><paramref name="n"/> records settled by a person with nothing in view: Acme's owner kim, Beta's lee.
    /// </summary>
    internal static List<SettledRecord> Alternating(int n)
    {
        using var maker = LowlineEngine.Create(Intake);
        return [.. Enumerable.Range(0, n).Select(i => maker.Settle(
            $"r{i}",
            new Dictionary<string, FieldValue>
            {
                ["customer"] = i % 2 == 0 ? "Acme" : "Beta",
                ["owner"] = i % 2 == 0 ? "kim" : "lee",
            },
            null,
            SettledBy.Person,
            Start.AddMinutes(i)))];
    }

    /// <summary>A draft in which <paramref name="value"/> was shown for <paramref name="field"/> — the account the form
    /// element keeps while a record is written.</summary>
    internal static string Shown(string field, string value) =>
        new JsonObject
        {
            ["opened"] = new JsonObject(),
            ["fields"] = new JsonObject
            {
                [field] = new JsonObject { ["shown"] = new JsonObject { ["value"] = value }, ["declined"] = false },
            },
        }.ToJsonString();

    [Fact]
    public void A_record_settled_elsewhere_becomes_the_line_to_store()
    {
        using var engine = LowlineEngine.Create(Intake);
        var saved = new Dictionary<string, FieldValue> { ["customer"] = "Acme", ["owner"] = "kim" };
        var made = engine.Record("r1", saved, new Dictionary<string, SettlementKind> { ["owner"] = SettlementKind.Accept },
            Start);
        engine.Settled.Should().Be(0);
        JsonNode.Parse(made.Json)!["settlements"]!["owner"]!.GetValue<string>().Should().Be("Accept");
        engine.Learn([made.Json]);
        engine.Settled.Should().Be(1);

        var refused = () => engine.Record("r2", saved,
            new Dictionary<string, SettlementKind> { ["customer"] = SettlementKind.Enter }, Start);
        refused.Should().Throw<ArgumentException>().WithMessage("*does not decide*");

        // A field held back for a check while the record was written carries the probability it was drawn with.
        var checkedRecord = engine.Record("r3", saved, null, Start, new Dictionary<string, double> { ["owner"] = 0.05 });
        var line = JsonNode.Parse(checkedRecord.Json)!;
        line["settlements"]!["owner"]!.GetValue<string>().Should().Be("Check");
        line["probabilities"]!["owner"]!.GetValue<double>().Should().Be(0.05);
    }

    [Fact]
    public void One_field_is_asked_for_alone_and_while_typed_into()
    {
        var stored = Alternating(40);
        using var engine = LowlineEngine.Create(Intake);
        engine.Tune(stored.Select(r => r.Json));
        var values = new Dictionary<string, FieldValue> { ["customer"] = "Beta" };

        engine.ProposeField("new", values, "owner")!.Suggestion!.Value.Should().Be("lee");
        // A choice is picked, not written out: typing into it answers nothing.
        engine.ProposeField("new", values, "owner", typed: "l")!.Abstain.Should().Be(Abstain.Unsure);
        engine.ProposeField("new", values, "customer").Should().BeNull();
    }

    [Fact]
    public void A_record_deleted_since_is_forgotten_without_learning_the_rest_again()
    {
        var stored = Alternating(40);
        using var engine = LowlineEngine.Create(Intake);
        engine.Learn(stored.Select(r => r.Json));
        engine.Forget(["r0", "r2", "never-learned"]);
        engine.Settled.Should().Be(38);
        engine.Learn([stored[0].Json]);
        engine.Settled.Should().Be(39);
    }

    [Fact]
    public void Only_a_value_the_decider_would_show_is_drawn_for_a_check()
    {
        var stored = Alternating(40);
        using var engine = LowlineEngine.Create(Intake);
        engine.Tune(stored.Select(r => r.Json));
        var shown = engine.ProposeField("new", new Dictionary<string, FieldValue> { ["customer"] = "Beta" }, "owner")!;
        var recheck = new Recheck(0.1);

        recheck.Draw(shown, 0.05).Should().Be(0.1);
        recheck.Draw(shown, 0.1).Should().BeNull();
        new Recheck().Rate.Should().Be(0.05);
        // A class, a value from elsewhere and a field shown nothing are left as they are.
        recheck.Draw(shown with { Suggestion = shown.Suggestion! with { Fit = "prefix" } }, 0).Should().BeNull();
        recheck.Draw(shown with { Suggestion = shown.Suggestion! with { Origin = "other" } }, 0).Should().BeNull();
        recheck.Draw(shown with { Suggestion = null }, 0).Should().BeNull();
        new Recheck(0).Draw(shown, 0).Should().BeNull();
    }

    [Fact]
    public void A_host_round()
    {
        var stored = Alternating(40);
        using var engine = LowlineEngine.Create(Intake);
        engine.Learn(stored.Select(r => r.Json));
        engine.Settled.Should().Be(40);
        engine.Restore(null);
        engine.Stale.Should().Be(new Staleness("untuned"));

        var tuning = engine.Tune(stored.Select(r => r.Json));
        engine.Stale.Should().BeNull();
        JsonNode.Parse(tuning)!["tuning"]!["settled"]!.GetValue<int>().Should().Be(40);
        var report = engine.Report!.Should().ContainSingle().Subject;
        report.Field.Should().Be("owner");
        report.Key!.Precision.Should().BeGreaterThanOrEqualTo(0.8);
        report.Lookups.Should().Be(39);
        // Counted by default on values settled with nothing in view; none of these records holds a check.
        (report.Checks, report.Counting).Should().Be((0, Counting.Unprompted));

        var shown = engine.Propose("new", new Dictionary<string, FieldValue> { ["customer"] = "Beta" });
        shown.Should().ContainSingle();
        shown[0].Field.Should().Be("owner");
        shown[0].Suggestion!.Value.Should().Be("lee");
        shown[0].Prefill.Should().BeTrue();
        shown[0].Layer.Should().Be(Layer.Key);
        shown[0].Promise.Should().Be(report.Key.Promise, "the promise of the key threshold the answer was held to");
        // The key layer keeps values as it compares them — folded to lower case.
        shown[0].Basis.Should().Contain(new Basis("value", "customer", "beta"));

        var kimOnly = engine.Propose(
            "new",
            new Dictionary<string, FieldValue> { ["customer"] = "Beta" },
            new Dictionary<string, IReadOnlyList<string>> { ["owner"] = ["kim"] });
        kimOnly[0].Suggestion.Should().BeNull();
        kimOnly[0].Abstain.Should().Be(Abstain.NotAllowed);

        var saved = engine.Settle(
            "new",
            new Dictionary<string, FieldValue> { ["customer"] = "Beta", ["owner"] = "lee" },
            Shown("owner", "lee"),
            SettledBy.Person,
            Start.AddMinutes(40));
        saved.Id.Should().Be("new");
        JsonNode.Parse(saved.Json)!["settlements"]!["owner"]!.GetValue<string>().Should().Be("Accept");
        JsonNode.Parse(saved.Json)!["settled_at"]!.GetValue<long>()
            .Should().Be(LowlineEngine.Ticks(Start.AddMinutes(40)));
        engine.Settled.Should().Be(41);

        using var restarted = LowlineEngine.Create(Intake);
        restarted.Learn([.. stored.Select(r => r.Json), saved.Json]);
        restarted.Restore(tuning);
        restarted.Stale.Should().BeNull();
        restarted.Propose("new", new Dictionary<string, FieldValue> { ["customer"] = "Beta" })
            .Should().BeEquivalentTo(shown);
    }

    private static readonly string[] Labels = ["b", "a"];

    [Fact]
    public void A_field_of_several_values_crosses_as_a_list()
    {
        const string tags = """
            {
              "name": "tags",
              "form": { "fields": [
                { "name": "customer", "kind": "text" },
                { "name": "labels", "kind": "choice", "choices": ["a", "b", "c"], "multiple": true }
              ] }
            }
            """;
        using var engine = LowlineEngine.Create(tags);
        var saved = engine.Settle(
            "r",
            new Dictionary<string, FieldValue> { ["customer"] = "Acme", ["labels"] = Labels },
            null,
            SettledBy.Person,
            Start);
        JsonNode.Parse(saved.Json)!["sets"]!["labels"]!.AsArray().Select(n => n!.GetValue<string>())
            .Should().Equal("a", "b");
    }

    [Fact]
    public void Fields_settled_together_are_held_back_together()
    {
        const string assign = """
            {
              "name": "assign",
              "form": { "fields": [
                { "name": "customer", "kind": "text" },
                { "name": "site", "kind": "text" },
                { "name": "owner", "kind": "choice", "choices": ["kim", "lee"], "evidence": false, "together": "g" },
                { "name": "team", "kind": "choice", "choices": ["x", "y", "z"], "evidence": false, "together": "g" }
              ] }
            }
            """;
        using var engine = LowlineEngine.Create(assign);
        // Acme's owner is always kim but its team goes either way; Beta's are always lee and z.
        string[][] rows = [["Acme", "east", "kim", "x"], ["Beta", "west", "lee", "z"], ["Acme", "east", "kim", "y"],
            ["Beta", "west", "lee", "z"]];
        var stored = Enumerable.Range(0, 80).Select(i =>
        {
            var row = rows[i % 4];
            return engine.Settle($"r{i}", new Dictionary<string, FieldValue>
            {
                ["customer"] = row[0], ["site"] = row[1], ["owner"] = row[2], ["team"] = row[3],
            }, null, SettledBy.Person, Start.AddMinutes(i)).Json;
        }).ToList();
        engine.Tune(stored);

        var shown = engine.Propose("a", new Dictionary<string, FieldValue> { ["customer"] = "Acme", ["site"] = "east" });
        var owner = shown.Single(p => p.Field == "owner");
        owner.Suggestion.Should().BeNull();
        owner.Abstain.Should().Be(Abstain.Together);
        owner.With.Should().Equal("team");

        // A group only one field is in holds nothing back: the form is refused.
        var lone = () => LowlineEngine.Create(assign.Replace(
            "[\"x\", \"y\", \"z\"], \"evidence\": false, \"together\": \"g\"", "[\"x\", \"y\", \"z\"]"));
        lone.Should().Throw<ArgumentException>().WithMessage("*no other field*");
    }

    [Fact]
    public void Refused_input_is_an_argument_exception_and_changes_nothing()
    {
        var act = () => LowlineEngine.Create("{");
        act.Should().Throw<ArgumentException>().WithMessage("definition does not read*");

        using var engine = LowlineEngine.Create(Intake);
        var foreign = () => engine.Learn([@"{""id"":""r"",""settled_at"":0,""values"":{""colour"":""red""}}"]);
        foreign.Should().Throw<ArgumentException>()
            .WithMessage("record 'r' has a value for 'colour', which the form does not have");
        engine.Settled.Should().Be(0);
    }

    [Fact]
    public void A_disposed_engine_says_so()
    {
        var engine = LowlineEngine.Create(Intake);
        engine.Dispose();
        engine.Dispose();
        var act = () => engine.Settled;
        act.Should().Throw<ObjectDisposedException>();
    }
}
