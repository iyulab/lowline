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
    private async Task<HttpClient> StartAsync(Action<LowlineWebOptions>? configure = null)
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
            configure?.Invoke(o);
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
    public async Task The_report_says_per_decided_field_what_the_replay_saw_in_the_requests_memory_space()
    {
        await Seed("seoul");
        using var client = await StartAsync();

        using var seoul = new HttpRequestMessage(HttpMethod.Get, "/lowline/intake/report");
        seoul.Headers.Add("X-Space", "seoul");
        using var reported = await client.SendAsync(seoul, Ct);
        reported.StatusCode.Should().Be(HttpStatusCode.OK);
        var fields = JsonNode.Parse(await reported.Content.ReadAsStringAsync(Ct))!.AsArray();
        fields.Should().ContainSingle();
        fields[0]!["field"]!.GetValue<string>().Should().Be("owner");
        var key = fields[0]!["key"]!;
        key["precision"]!.GetValue<double>().Should().BeGreaterThanOrEqualTo(0.8);
        key["answered"]!.GetValue<int>().Should().BePositive();

        // An empty space has nothing to choose on: the field is reported, with no threshold.
        using var empty = await client.GetAsync(new Uri("/lowline/intake/report", UriKind.Relative), Ct);
        var none = JsonNode.Parse(await empty.Content.ReadAsStringAsync(Ct))!.AsArray();
        none.Should().ContainSingle();
        none[0]!["key"].Should().BeNull("an empty space earns no threshold, and the part is left out");

        using var missing = await client.GetAsync(new Uri("/lowline/other/report", UriKind.Relative), Ct);
        missing.StatusCode.Should().Be(HttpStatusCode.NotFound);
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
        (await unfilled.Content.ReadAsStringAsync(Ct)).Should().Contain("No model is configured");
        using var unjudged = await client.SendAsync(Post("/lowline/intake/judge", new { id = "r", values = new { } }), Ct);
        unjudged.StatusCode.Should().Be(HttpStatusCode.NotFound);

        using var garbled = await client.PostAsync(
            new Uri("/lowline/intake/propose", UriKind.Relative), new StringContent("{", null, "application/json"), Ct);
        garbled.StatusCode.Should().Be(HttpStatusCode.BadRequest);

        using var refused = await client.SendAsync(
            Post("/lowline/intake/settle", new { id = "r", saved = new { }, draft = new { opened = 3 } }), Ct);
        refused.StatusCode.Should().Be(HttpStatusCode.BadRequest);
        (await refused.Content.ReadAsStringAsync(Ct)).Should().Contain("draft does not read");

        // A value the form cannot hold is refused, and nothing is stored.
        using var outside = await client.SendAsync(
            Post("/lowline/intake/settle", new { id = "r", saved = new { customer = "Acme", owner = "nobody" } }), Ct);
        outside.StatusCode.Should().Be(HttpStatusCode.BadRequest);
        (await outside.Content.ReadAsStringAsync(Ct)).Should().Contain("none of its choices");
        using var unknown = await client.SendAsync(
            Post("/lowline/intake/settle", new { id = "r", saved = new { custmer = "Acme" } }), Ct);
        unknown.StatusCode.Should().Be(HttpStatusCode.BadRequest);
        (await _store.ReadRecordsAsync(new LowlineScope("intake", "default"), Ct)).Should().NotContain(r => r.Id == "r");
    }

    [Fact]
    public async Task A_host_that_stores_its_own_records_has_what_it_stored_learned_not_what_the_request_says()
    {
        await Seed("seoul");
        // The host's own table: record "new" was saved through its API, with owner corrected to lee.
        var hosted = new Dictionary<string, IReadOnlyDictionary<string, FieldValue>>
        {
            ["new"] = new Dictionary<string, FieldValue> { ["customer"] = "Beta", ["owner"] = "lee" },
        };
        using var client = await StartAsync(o => o.Saved = (_, form, id, _) =>
            ValueTask.FromResult(form == "intake" && hosted.TryGetValue(id, out var values) ? values : null));

        using var settled = await client.SendAsync(
            Post(
                "/lowline/intake/settle",
                new
                {
                    id = "new",
                    saved = new { customer = "Beta", owner = "kim" },
                    draft = JsonNode.Parse(EngineTests.Shown("owner", "lee")),
                },
                "seoul"),
            Ct);
        settled.StatusCode.Should().Be(HttpStatusCode.OK);
        var stored = await _store.ReadRecordsAsync(new LowlineScope("intake", "seoul"), Ct);
        var record = JsonNode.Parse(stored.Single(r => r.Id == "new").Json)!;
        record["values"]!["owner"]!.GetValue<string>().Should().Be("lee");
        record["settlements"]!["owner"]!.GetValue<string>().Should().Be("Accept");

        // A record the host never stored is not found, and nothing is learned from what the request carries.
        using var unstored = await client.SendAsync(
            Post("/lowline/intake/settle", new { id = "forged", saved = new { owner = "kim" }, draft = (object?)null }, "seoul"),
            Ct);
        unstored.StatusCode.Should().Be(HttpStatusCode.NotFound);
        (await _store.ReadRecordsAsync(new LowlineScope("intake", "seoul"), Ct)).Should().HaveCount(41);

        // Without saved values of its own to read, the host reads them from its records: none needed in the request.
        hosted["second"] = new Dictionary<string, FieldValue> { ["customer"] = "Beta", ["owner"] = "lee" };
        using var bare = await client.SendAsync(
            Post("/lowline/intake/settle", new { id = "second", draft = (object?)null }, "seoul"), Ct);
        bare.StatusCode.Should().Be(HttpStatusCode.OK);
    }

    [Fact]
    public async Task A_host_that_reads_no_records_of_its_own_needs_the_saved_values_in_the_request()
    {
        using var client = await StartAsync();
        using var bare = await client.SendAsync(Post("/lowline/intake/settle", new { id = "r", draft = (object?)null }), Ct);
        bare.StatusCode.Should().Be(HttpStatusCode.BadRequest);
        (await bare.Content.ReadAsStringAsync(Ct)).Should().Contain("no saved values");
        (await _store.ReadRecordsAsync(new LowlineScope("intake", "default"), Ct)).Should().BeEmpty();
    }

    public async ValueTask DisposeAsync()
    {
        if (_app is not null)
        {
            await _app.DisposeAsync();
        }
    }
}
