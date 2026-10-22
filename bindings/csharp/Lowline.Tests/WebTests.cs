using System.Net;
using System.Net.Http.Json;
using System.Text.Json.Nodes;
using AwesomeAssertions;
using Lowline.AspNetCore;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Hosting.Server;
using Microsoft.AspNetCore.Hosting.Server.Features;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;

namespace Lowline.Tests;

/// <summary>The two pieces a web host writes — <c>AddLowline</c> and <c>MapLowline</c> — put a form's suggestions and
/// saves behind two routes, each request answered from its own memory space.</summary>
public sealed class WebTests : IAsyncDisposable
{
    private readonly InMemoryLowlineStore _store = new();
    private WebApplication? _app;

    private static CancellationToken Ct => TestContext.Current.CancellationToken;

    /// <summary>A host on a free local port whose memory space is the request's <c>X-Space</c> header (a stand-in for
    /// the signed-in user's workplace), and whose people in space <c>kim-only</c> may pick only kim.</summary>
    private async Task<HttpClient> StartAsync()
    {
        var builder = WebApplication.CreateSlimBuilder();
        builder.WebHost.UseUrls("http://127.0.0.1:0");
        builder.Logging.ClearProviders();
        builder.Services.AddLowline(o =>
        {
            o.UseStore(_store).Form("intake", EngineTests.Intake);
            o.Space = context => context.Request.Headers["X-Space"].ToString() is { Length: > 0 } space
                ? space
                : "default";
            o.Allowed = (context, _) => context.Request.Headers["X-Space"] == "kim-only"
                ? new Dictionary<string, IReadOnlyList<string>> { ["owner"] = ["kim"] }
                : null;
        });
        _app = builder.Build();
        _app.MapLowline("/lowline");
        await _app.StartAsync(Ct);
        var address = _app.Services.GetRequiredService<IServer>().Features.Get<IServerAddressesFeature>()!
            .Addresses.Single();
        return new HttpClient { BaseAddress = new Uri(address) };
    }

    private async Task Seed(string space)
    {
        foreach (var record in EngineTests.Alternating(40))
        {
            await _store.AddRecordAsync(new LowlineScope("intake", space), record, Ct);
        }
    }

    private static HttpRequestMessage Post(string path, object body, string? space = null)
    {
        var request = new HttpRequestMessage(HttpMethod.Post, path) { Content = JsonContent.Create(body) };
        if (space is not null)
        {
            request.Headers.Add("X-Space", space);
        }

        return request;
    }

    [Fact]
    public async Task A_record_is_proposed_for_and_saved_through_the_routes()
    {
        await Seed("seoul");
        await Seed("kim-only");
        using var client = await StartAsync();

        var propose = Post("/lowline/intake/propose", new { id = "new", values = new { customer = "Beta" } }, "seoul");
        using var proposed = await client.SendAsync(propose, Ct);
        proposed.StatusCode.Should().Be(HttpStatusCode.OK);
        var shown = JsonNode.Parse(await proposed.Content.ReadAsStringAsync(Ct))!.AsArray();
        shown[0]!["field"]!.GetValue<string>().Should().Be("owner");
        shown[0]!["suggestion"]!["value"]!.GetValue<string>().Should().Be("lee");

        // Another space has no records of its own; one that may pick only kim is not shown lee.
        using var elsewhere = await client.SendAsync(
            Post("/lowline/intake/propose", new { id = "new", values = new { customer = "Beta" } }, "busan"), Ct);
        JsonNode.Parse(await elsewhere.Content.ReadAsStringAsync(Ct))![0]!["abstain"]!.GetValue<string>()
            .Should().Be("needs-judgement");
        using var kimOnly = await client.SendAsync(
            Post("/lowline/intake/propose", new { id = "new", values = new { customer = "Beta" } }, "kim-only"), Ct);
        JsonNode.Parse(await kimOnly.Content.ReadAsStringAsync(Ct))![0]!["abstain"]!.GetValue<string>()
            .Should().Be("not-allowed");

        var settle = Post(
            "/lowline/intake/settle",
            new
            {
                id = "new",
                saved = new { customer = "Beta", owner = "lee" },
                draft = JsonNode.Parse(EngineTests.Shown("owner", "lee")),
            },
            "seoul");
        using var settled = await client.SendAsync(settle, Ct);
        settled.StatusCode.Should().Be(HttpStatusCode.OK);
        JsonNode.Parse(await settled.Content.ReadAsStringAsync(Ct))!["id"]!.GetValue<string>().Should().Be("new");
        var stored = await _store.ReadRecordsAsync(new LowlineScope("intake", "seoul"), Ct);
        stored.Should().HaveCount(41);
        JsonNode.Parse(stored.Single(r => r.Id == "new").Json)!["settlements"]!["owner"]!.GetValue<string>()
            .Should().Be("Accept");
    }

    [Fact]
    public async Task A_form_not_defined_is_not_found_and_a_body_that_does_not_read_is_refused()
    {
        using var client = await StartAsync();
        using var missing = await client.SendAsync(Post("/lowline/other/propose", new { id = "r", values = new { } }), Ct);
        missing.StatusCode.Should().Be(HttpStatusCode.NotFound);
        // No model given: no filling.
        using var unfilled = await client.SendAsync(Post("/lowline/intake/fill", new { values = new { }, text = "x" }), Ct);
        unfilled.StatusCode.Should().Be(HttpStatusCode.NotFound);
        using var unjudged = await client.SendAsync(Post("/lowline/intake/judge", new { id = "r", values = new { } }), Ct);
        unjudged.StatusCode.Should().Be(HttpStatusCode.NotFound);

        using var garbled = await client.PostAsync(
            new Uri("/lowline/intake/propose", UriKind.Relative), new StringContent("{", null, "application/json"), Ct);
        garbled.StatusCode.Should().Be(HttpStatusCode.BadRequest);

        using var refused = await client.SendAsync(
            Post("/lowline/intake/settle", new { id = "r", saved = new { }, draft = new { opened = 3 } }), Ct);
        refused.StatusCode.Should().Be(HttpStatusCode.BadRequest);
        (await refused.Content.ReadAsStringAsync(Ct)).Should().Contain("draft does not read");
    }

    public async ValueTask DisposeAsync()
    {
        if (_app is not null)
        {
            await _app.DisposeAsync();
        }
    }
}
