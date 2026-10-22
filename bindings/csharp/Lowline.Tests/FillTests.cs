using AwesomeAssertions;

namespace Lowline.Tests;

/// <summary>Filling a form from what a person wrote: the host's model is told the fields still empty, and what it
/// answers is shown as suggestions from elsewhere — or not at all, with why, when its field cannot hold it.</summary>
public sealed class FillTests
{
    private static CancellationToken Ct => TestContext.Current.CancellationToken;

    private static readonly LowlineScope Seoul = new("intake", "seoul");

    /// <summary>A model that reads «customer, owner» out of the text, and says what it was told.</summary>
    private sealed class CommaModel : ILowlineModel
    {
        public LowlineFillRequest? Asked { get; private set; }

        public Task<IReadOnlyDictionary<string, FieldValue>> FillAsync(
            LowlineFillRequest request, CancellationToken cancellationToken = default)
        {
            Asked = request;
            var parts = request.Text.Split(',', StringSplitOptions.TrimEntries);
            IReadOnlyDictionary<string, FieldValue> answered = new Dictionary<string, FieldValue>
            {
                ["customer"] = parts[0],
                ["owner"] = parts[1],
            };
            return Task.FromResult(answered);
        }
    }

    [Fact]
    public void The_engine_tells_what_to_fill_and_checks_what_comes_back()
    {
        using var engine = LowlineEngine.Create(EngineTests.Intake);
        var empty = new Dictionary<string, FieldValue>();
        var told = engine.Describe(empty, new Dictionary<string, IReadOnlyList<string>> { ["owner"] = ["lee"] });
        told.Select(f => (f.Name, f.Kind)).Should().Equal(("customer", FieldKind.Text), ("owner", FieldKind.Choice));
        told[0].Choices.Should().BeNull();
        told[1].Choices.Should().Equal("lee");

        var shown = engine.Fill(empty, new Dictionary<string, FieldValue> { ["customer"] = "Beta", ["owner"] = "park" });
        shown[0].Suggestion.Should().Be(new Suggestion("Beta", "other"));
        shown[0].Prefill.Should().BeFalse();
        shown[1].Suggestion.Should().BeNull();
        shown[1].Abstain.Should().Be(Abstain.NotAChoice);
    }

    [Fact]
    public async Task Forms_fill_through_the_host_model_only_the_fields_still_empty()
    {
        var model = new CommaModel();
        using var forms = new LowlineOptions().UseStore(new InMemoryLowlineStore()).UseModel(model)
            .Form("intake", EngineTests.Intake).Build();
        forms.CanFill.Should().BeTrue();

        var shown = await forms.FillAsync(
            Seoul, new Dictionary<string, FieldValue> { ["customer"] = "Acme" }, "Beta, lee", cancellationToken: Ct);
        model.Asked!.Fields.Select(f => f.Name).Should().Equal("owner");
        model.Asked.Text.Should().Be("Beta, lee");
        shown.Should().ContainSingle().Which.Suggestion.Should().Be(new Suggestion("lee", "other"));
    }

    [Fact]
    public async Task Without_a_model_there_is_no_filling()
    {
        using var forms = new LowlineOptions().UseStore(new InMemoryLowlineStore())
            .Form("intake", EngineTests.Intake).Build();
        forms.CanFill.Should().BeFalse();
        var act = () => forms.FillAsync(Seoul, new Dictionary<string, FieldValue>(), "Beta, lee", cancellationToken: Ct);
        await act.Should().ThrowAsync<InvalidOperationException>().WithMessage("*UseModel*");
    }
}
