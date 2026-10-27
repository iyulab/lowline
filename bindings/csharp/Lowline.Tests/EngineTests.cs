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

    [Fact]
    public void An_audit_draws_a_settled_record_at_its_rate_and_is_off_by_default()
    {
        var audit = new Audit(0.1);
        audit.Draw(0.05).Should().Be(0.1);
        audit.Draw(0.1).Should().BeNull();
        new Audit().Draw(0).Should().BeNull();
        new Audit(1).Draw(0.99).Should().Be(1);
    }

    [Fact]
    public void A_draft_that_reports_more_gives_a_record_that_says_more()
    {
        var definition = JsonNode.Parse(Intake)!.AsObject();
        definition["formVersion"] = "owners-2";
        using var engine = LowlineEngine.Create(definition.ToJsonString());

        // The draft the form element keeps, as it sends it: what was shown with its layer and promise, the times on
        // the page's clock, the order values arrived in, who saved and the batch.
        const string draft = """
            {
              "opened": {},
              "fields": { "owner": { "shown": { "value": "lee" }, "declined": false, "layer": "key", "promise": 0.9, "at": 2001 } },
              "opened_at": 1000, "saved_at": 4000, "arrival": ["customer", "owner"], "by": "person-7", "batch": "import-3"
            }
            """;
        var saved = engine.Settle(
            "new",
            new Dictionary<string, FieldValue> { ["customer"] = "Beta", ["owner"] = "lee" },
            draft,
            SettledBy.Person,
            Start);

        var record = JsonNode.Parse(saved.Json)!;
        record["settlements"]!["owner"]!.GetValue<string>().Should().Be("Accept");
        record["suggested"]!["owner"]!.GetValue<string>().Should().Be("lee");
        record["sources"]!["owner"]!.GetValue<string>().Should().Be("KeyMemory");
        record["promises"]!["owner"]!.GetValue<double>().Should().Be(0.9);
        record["settle_ms"]!["owner"]!.GetValue<long>().Should().Be(1999);
        record["open_ms"]!.GetValue<long>().Should().Be(3000);
        record["settled_by"]!["owner"]!.GetValue<string>().Should().Be("person-7");
        record["arrival"]!.AsArray().Select(a => a!.GetValue<string>()).Should().Equal("customer", "owner");
        record["batch"]!.GetValue<string>().Should().Be("import-3");
        record["form_version"]!.GetValue<string>().Should().Be("owners-2");

        // A draft that reports nothing more gives the record it always did.
        var plain = JsonNode.Parse(engine.Settle(
            "plain",
            new Dictionary<string, FieldValue> { ["customer"] = "Beta", ["owner"] = "lee" },
            null,
            SettledBy.Person,
            Start).Json)!.AsObject();
        plain.ContainsKey("suggested").Should().BeFalse();
        plain.ContainsKey("settled_by").Should().BeFalse();
        plain["form_version"]!.GetValue<string>().Should().Be("owners-2");
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

        // Both sure for Beta: drawn to be checked, the owner holds back the team suggested alongside it.
        var beta = engine.Propose("b", new Dictionary<string, FieldValue> { ["customer"] = "Beta", ["site"] = "west" });
        beta.Should().OnlyContain(p => p.Together == "g" && p.Suggestion != null);
        Recheck.Hidden(beta, ["owner"]).Should().Equal("owner", "team");
        Recheck.Hidden(beta, []).Should().BeEmpty();

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
