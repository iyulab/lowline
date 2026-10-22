using AwesomeAssertions;

namespace Lowline.Tests;

/// <summary>Judging what the records could not answer: a proposal asks for a judgement and says what to read, the
/// host's model judges it, and its value is offered back to the decider — shown as an answer when trusted and among the
/// choices, settled as any other answer when a person takes it.</summary>
public sealed class JudgeTests
{
    private static CancellationToken Ct => TestContext.Current.CancellationToken;

    private static readonly LowlineScope Seoul = new("intake", "seoul");

    /// <summary>A model that judges every owner to be lee, and says what it was asked.</summary>
    private sealed class LeeModel : ILowlineModel
    {
        public List<LowlineJudgeRequest> Asked { get; } = [];

        public Task<IReadOnlyDictionary<string, FieldValue>> FillAsync(
            LowlineFillRequest request, CancellationToken cancellationToken = default) =>
            Task.FromResult<IReadOnlyDictionary<string, FieldValue>>(new Dictionary<string, FieldValue>());

        public Task<IReadOnlyList<JudgedValue>> JudgeAsync(
            LowlineJudgeRequest request, CancellationToken cancellationToken = default)
        {
            lock (Asked)
            {
                Asked.Add(request);
            }

            return Task.FromResult<IReadOnlyList<JudgedValue>>([new JudgedValue("lee", 0.8, true)]);
        }
    }

    /// <summary>A model that fills but does not judge.</summary>
    private sealed class FillOnlyModel : ILowlineModel
    {
        public Task<IReadOnlyDictionary<string, FieldValue>> FillAsync(
            LowlineFillRequest request, CancellationToken cancellationToken = default) =>
            Task.FromResult<IReadOnlyDictionary<string, FieldValue>>(new Dictionary<string, FieldValue>());
    }

    [Fact]
    public void The_engine_takes_a_judgement_only_where_the_records_asked_for_one()
    {
        using var engine = LowlineEngine.Create(EngineTests.Intake);
        var values = new Dictionary<string, FieldValue> { ["customer"] = "Gamma" };
        var asked = engine.Propose("new", values).Single();
        asked.Abstain.Should().Be(Abstain.NeedsJudgement);
        asked.Asks.Should().ContainSingle().Which.Should().Equal("customer", "Gamma");

        var shown = engine.Offer("new", values, "owner", [new JudgedValue("lee", 0.8, true)])!;
        shown.Suggestion.Should().Be(new Suggestion("lee"));
        shown.Layer.Should().Be(Layer.Judgement);
        engine.Offer("new", values, "owner", [new JudgedValue("park", 0.9, true)])!.Suggestion.Should().BeNull();
        engine.Offer("new", values, "customer", []).Should().BeNull();

        // Taken and saved, it is an answer the decider gave.
        var record = engine.Settle(
            "new",
            new Dictionary<string, FieldValue> { ["customer"] = "Gamma", ["owner"] = "lee" },
            EngineTests.Shown("owner", "lee"),
            SettledBy.Person,
            EngineTests.Start);
        record.Json.Should().Contain("\"owner\":\"Accept\"");
    }

    [Fact]
    public async Task Forms_judge_through_the_host_model_only_what_the_records_could_not_answer()
    {
        var model = new LeeModel();
        var store = new InMemoryLowlineStore();
        foreach (var record in EngineTests.Alternating(40))
        {
            await store.AddRecordAsync(Seoul, record, Ct);
        }

        using var forms = new LowlineOptions().UseStore(store).UseModel(model)
            .Form("intake", EngineTests.Intake).Build();

        // A known customer is answered from the records: nothing is asked.
        var known = await forms.JudgeAsync(
            Seoul, "r1", new Dictionary<string, FieldValue> { ["customer"] = "Acme" }, cancellationToken: Ct);
        known.Should().BeEmpty();
        model.Asked.Should().BeEmpty();

        // A new one is put to the model with what to read, among the choices this person may pick.
        var judged = await forms.JudgeAsync(
            Seoul,
            "r2",
            new Dictionary<string, FieldValue> { ["customer"] = "Gamma" },
            new Dictionary<string, IReadOnlyList<string>> { ["owner"] = ["kim", "lee"] },
            Ct);
        var asked = model.Asked.Should().ContainSingle().Which;
        asked.Field.Should().Be("owner");
        asked.Choices.Should().Equal("kim", "lee");
        asked.Evidence.Should().ContainSingle().Which.Should().Be(KeyValuePair.Create("customer", "Gamma"));
        judged.Should().ContainSingle().Which.Suggestion.Should().Be(new Suggestion("lee"));
    }

    [Fact]
    public async Task A_field_with_nothing_to_read_yet_is_not_put_to_the_model()
    {
        // Nothing written yet: the proposal asks with nothing to read — its lists empty, not missing — and a model
        // would only guess, which the decider's guesses already do.
        using var engine = LowlineEngine.Create(EngineTests.Intake);
        var asked = engine.Propose("new", new Dictionary<string, FieldValue>()).Single();
        asked.Asks.Should().BeEmpty();
        asked.Basis.Should().BeEmpty();

        var model = new LeeModel();
        using var forms = new LowlineOptions().UseStore(new InMemoryLowlineStore()).UseModel(model)
            .Form("intake", EngineTests.Intake).Build();
        var judged = await forms.JudgeAsync(Seoul, "r", new Dictionary<string, FieldValue>(), cancellationToken: Ct);
        model.Asked.Should().BeEmpty();
        judged.Should().BeEmpty();
    }

    [Fact]
    public async Task A_model_that_does_not_judge_leaves_the_field_asking()
    {
        using var forms = new LowlineOptions().UseStore(new InMemoryLowlineStore()).UseModel(new FillOnlyModel())
            .Form("intake", EngineTests.Intake).Build();
        var judged = await forms.JudgeAsync(
            Seoul, "r", new Dictionary<string, FieldValue> { ["customer"] = "Gamma" }, cancellationToken: Ct);
        judged.Should().ContainSingle().Which.Suggestion.Should().BeNull();

        using var unmodelled = new LowlineOptions().UseStore(new InMemoryLowlineStore())
            .Form("intake", EngineTests.Intake).Build();
        var act = () => unmodelled.JudgeAsync(Seoul, "r", new Dictionary<string, FieldValue>(), cancellationToken: Ct);
        await act.Should().ThrowAsync<InvalidOperationException>().WithMessage("*UseModel*");
    }
}
