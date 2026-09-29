using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using Lowline.Host;
using Microsoft.AspNetCore.Mvc.Testing;

namespace Lowline.Host.Tests;

public sealed class HostTests : IClassFixture<HostTests.Factory>
{
    public const string Token = "test-token";

    public sealed class Factory : WebApplicationFactory<Program>
    {
        protected override void ConfigureWebHost(Microsoft.AspNetCore.Hosting.IWebHostBuilder builder) =>
            builder.UseSetting(HostAuth.TokenVariable, Token);
    }

    private readonly Factory _factory;

    public HostTests(Factory factory) => _factory = factory;

    private HttpClient Client(string? token)
    {
        var client = _factory.CreateClient();
        if (token is not null)
        {
            client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
        }
        return client;
    }

    [Fact]
    public async Task Health_answers_with_the_token()
    {
        var health = await Client(Token).GetFromJsonAsync<Health>("/health", TestContext.Current.CancellationToken);
        Assert.Equal(new Health("ok", VaultIndexed: false, MemoryReady: false), health);
    }

    [Fact]
    public async Task Ingests_a_vault_and_serves_its_table_over_http()
    {
        // Its own host: ingesting changes state the other tests read.
        await using var factory = new Factory();
        var client = factory.CreateClient();
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", Token);
        var ingest = await client.PostAsync("/vault/ingest?vault=D%3A%2F%EB%B3%BC%ED%8A%B8", new StringContent("""
            {"templates": [{"ref": "bug-report@1", "fields": [{"name": "제목", "type": "text"}, {"name": "재현됨", "type": "checkbox"}]}],
             "documents": [{"path": "문서/a.md", "template": "bug-report@1", "values": {"제목": "멈춤", "재현됨": true}}]}
            """, System.Text.Encoding.UTF8, "application/json"), TestContext.Current.CancellationToken);
        ingest.EnsureSuccessStatusCode();
        Assert.Equal("""{"appended":1,"retired":0,"projections":["bug-report@1"],"skipped":[]}""",
            await ingest.Content.ReadAsStringAsync(TestContext.Current.CancellationToken));

        var table = await client.GetStringAsync("/projection/bug-report@1", TestContext.Current.CancellationToken);
        Assert.Equal(
            """{"template":"bug-report@1","columns":[{"name":"제목","type":"text"},{"name":"재현됨","type":"checkbox"}],"rows":[{"path":"문서/a.md","values":{"제목":"멈춤","재현됨":true}}]}""",
            System.Text.RegularExpressions.Regex.Unescape(table));

        var health = await client.GetFromJsonAsync<Health>("/health", TestContext.Current.CancellationToken);
        Assert.True(health!.VaultIndexed);
        Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync("/projection/none@1", TestContext.Current.CancellationToken)).StatusCode);
    }

    [Fact]
    public async Task Reads_a_document_marked_conflicted_over_http()
    {
        await using var factory = new Factory();
        var client = factory.CreateClient();
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", Token);
        var ct = TestContext.Current.CancellationToken;
        var ingest = await client.PostAsync("/vault/ingest", new StringContent("""
            {"templates": [{"ref": "intake@1", "fields": [{"name": "요청", "type": "textarea"}, {"name": "담당", "type": "select"}], "suggest": ["담당"]}],
             "documents": [{"path": "문서/a.md", "template": "intake@1", "values": {"요청": "노트북 배터리가 금방 닳아요", "담당": "장비"}, "conflicted": true}]}
            """, System.Text.Encoding.UTF8, "application/json"), ct);
        ingest.EnsureSuccessStatusCode();

        var suggestion = await client.PostAsJsonAsync("/suggest",
            new { template = "intake@1", field = "담당", values = new { 요청 = "노트북 배터리가 금방 닳아요!" } }, ct);

        Assert.Equal(new Suggestion(null, "abstain", null, null), await suggestion.Content.ReadFromJsonAsync<Suggestion>(ct));
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("wrong")]
    [InlineData("test-token-and-more")]
    public async Task Every_request_without_the_token_is_refused(string? token)
    {
        var response = await Client(token).GetAsync("/health", TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task Unknown_paths_are_refused_before_routing_without_the_token()
    {
        var response = await Client(null).GetAsync("/nothing-here", TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }
}
