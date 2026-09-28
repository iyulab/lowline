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
