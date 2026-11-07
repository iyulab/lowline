using AwesomeAssertions;
using Lowline.Extensions.AI;
using Microsoft.Extensions.AI;

namespace Lowline.Tests;

/// <summary>The engine's model over a chat client: what it sends, what it keeps of the answer, and that a client on
/// another machine needs the host's leave.</summary>
public sealed class ChatClientModelTests
{
    private static CancellationToken Ct => TestContext.Current.CancellationToken;

    /// <summary>A chat client that answers what it is given and keeps what it was asked.</summary>
    private sealed class CannedClient(string answer, Uri? address = null) : IChatClient
    {
        public List<ChatMessage> Asked { get; } = [];

        public ChatOptions? Options { get; private set; }

        public Task<ChatResponse> GetResponseAsync(
            IEnumerable<ChatMessage> messages, ChatOptions? options = null, CancellationToken cancellationToken = default)
        {
            Asked.AddRange(messages);
            Options = options;
            return Task.FromResult(new ChatResponse(new ChatMessage(ChatRole.Assistant, answer)));
        }

        public IAsyncEnumerable<ChatResponseUpdate> GetStreamingResponseAsync(
            IEnumerable<ChatMessage> messages, ChatOptions? options = null, CancellationToken cancellationToken = default) =>
            throw new NotSupportedException();

        public object? GetService(Type serviceType, object? serviceKey = null) =>
            serviceType == typeof(ChatClientMetadata) ? new ChatClientMetadata("canned", address) : null;

        public void Dispose()
        {
        }
    }

    private static readonly FillField[] Fields =
    [
        new("customer", FieldKind.Text),
        new("owner", FieldKind.Choice, ["lee", "park"]),
        new("tags", FieldKind.Text),
    ];

    private static LowlineFillRequest Request(params LowlineAttachment[] attachments) =>
        new("intake", Fields, "Beta, lee", new Dictionary<string, FieldValue> { ["site"] = "seoul" })
        {
            Attachments = attachments,
        };

    [Fact]
    public async Task Fill_sends_the_request_and_keeps_only_the_fields_it_asked_for()
    {
        var client = new CannedClient("""
            ```json
            {"customer": "Beta", "owner": "lee", "tags": ["a", ""], "site": "busan", "note": ""}
            ```
            """);
        var model = new ChatClientLowlineModel(client);

        var photo = new LowlineAttachment("image/png", new byte[] { 1, 2, 3 }, "plate.png");
        var filled = await model.FillAsync(Request(photo), Ct);

        filled.Keys.Should().BeEquivalentTo("customer", "owner", "tags");
        filled["customer"].Text.Should().Be("Beta");
        filled["tags"].Values.Should().Equal("a");
        client.Options!.ResponseFormat.Should().Be(ChatResponseFormat.Json);

        var user = client.Asked.Single(m => m.Role == ChatRole.User);
        var prompt = user.Contents.OfType<TextContent>().Single().Text;
        prompt.Should().Contain("\"choices\":[\"lee\",\"park\"]").And.Contain("\"text\":\"Beta, lee\"")
            .And.Contain("\"values\":{\"site\":\"seoul\"}");
        var data = user.Contents.OfType<DataContent>().Single();
        data.MediaType.Should().Be("image/png");
        data.Name.Should().Be("plate.png");
        data.Data.ToArray().Should().Equal(1, 2, 3);
    }

    [Fact]
    public async Task An_answer_that_is_not_json_fills_nothing()
    {
        var model = new ChatClientLowlineModel(new CannedClient("I could not tell."));
        (await model.FillAsync(Request(), Ct)).Should().BeEmpty();
    }

    [Fact]
    public async Task Judge_keeps_values_among_the_choices_and_trusts_from_the_threshold()
    {
        var client = new CannedClient("""
            {"values": [{"value": "lee", "probability": 0.8}, {"value": "kim", "probability": 0.9},
                        {"value": "park", "probability": 0.4}, {"value": "lee", "probability": 1.5}]}
            """);
        var model = new ChatClientLowlineModel(client);
        var request = new LowlineJudgeRequest("intake", "owner", ["lee", "park"],
            [new("customer", "Beta")], new Dictionary<string, FieldValue> { ["customer"] = "Beta" });

        var judged = await model.JudgeAsync(request, Ct);

        judged.Should().Equal(new JudgedValue("lee", 0.8, true), new JudgedValue("park", 0.4, false));
    }

    [Fact]
    public async Task Judging_can_be_turned_off()
    {
        var client = new CannedClient("""{"values": [{"value": "lee", "probability": 0.9}]}""");
        var model = new ChatClientLowlineModel(client, new ChatClientLowlineModelOptions { Judge = false });
        var request = new LowlineJudgeRequest("intake", "owner", null, [], new Dictionary<string, FieldValue>());

        (await model.JudgeAsync(request, Ct)).Should().BeEmpty();
        client.Asked.Should().BeEmpty();
    }

    [Fact]
    public void A_client_on_another_machine_needs_leave()
    {
        var remote = new CannedClient("{}", new Uri("https://models.example.com/v1"));
        var refuse = () => new ChatClientLowlineModel(remote);
        refuse.Should().Throw<InvalidOperationException>().WithMessage("*models.example.com*AllowRemote*");

        var allowed = () => new ChatClientLowlineModel(remote, new ChatClientLowlineModelOptions { AllowRemote = true });
        allowed.Should().NotThrow();

        var local = () => new ChatClientLowlineModel(new CannedClient("{}", new Uri("http://localhost:11434")));
        local.Should().NotThrow();
        var inProcess = () => new ChatClientLowlineModel(new CannedClient("{}"));
        inProcess.Should().NotThrow();
    }

    [Fact]
    public async Task Forms_fill_through_a_chat_client()
    {
        var client = new CannedClient("""{"customer": "Beta", "owner": "lee"}""");
        using var forms = new LowlineOptions().UseStore(new InMemoryLowlineStore()).UseChatClient(client)
            .Form("intake", EngineTests.Intake).Build();
        forms.CanFill.Should().BeTrue();

        var shown = await forms.FillAsync(
            new LowlineScope("intake", "seoul"), new Dictionary<string, FieldValue>(), "Beta, lee", cancellationToken: Ct);

        shown.Select(f => f.Suggestion?.Value).Should().Contain("Beta");
    }
}
