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
