using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.DependencyInjection;

namespace Lowline.AspNetCore;

/// <summary>What a web host's forms run on: <see cref="LowlineOptions"/>, and what the host decides per request — the
/// memory space a request's records belong to, and the choices its person may pick.</summary>
public sealed class LowlineWebOptions : LowlineOptions
{
    /// <summary>The memory space of a request — a workplace, a team — whose records answer it and learn from its saves.
    /// One space, <c>default</c>, when left as it is. Authentication is the host's: derive the space from the request's
    /// user, not from anything the request says of itself.</summary>
    public Func<HttpContext, string> Space { get; set; } = _ => "default";

    /// <summary>The choices the request's person may pick now, by field, for a form — the host's permissions and active
    /// filters; <c>null</c>, or a field left out, allows any value. A value outside them is never suggested.</summary>
    public Func<HttpContext, string, IReadOnlyDictionary<string, IReadOnlyList<string>>?> Allowed { get; set; } =
        (_, _) => null;

    /// <summary>The values the host stored for record <c>id</c> of a form, read from its own records — for a host that
    /// saves through its own API (its permissions, validation and corrections) before <c>settle</c> is called. When
    /// given, <c>settle</c> learns these and does not read values from the request, so what is learned is what was
    /// stored; <c>null</c> — a record the host has not stored, or this person may not settle — is 404 and nothing is
    /// learned. Left <c>null</c>, the request's <c>saved</c> is the save: the route stores and learns it.</summary>
    public Func<HttpContext, string, string, CancellationToken, ValueTask<IReadOnlyDictionary<string, FieldValue>?>>?
        Saved { get; set; }
}

/// <summary>Putting a host's forms behind two routes.</summary>
public static class LowlineEndpoints
{
    /// <summary>Adds the forms <paramref name="configure"/> describes: their store (<c>UseSqlite</c> from
    /// Lowline.Sqlite, or <c>UseStore</c>), the forms themselves (<c>Form</c>), and how a request's memory space and
    /// allowed choices are found.</summary>
    public static IServiceCollection AddLowline(this IServiceCollection services, Action<LowlineWebOptions> configure)
    {
        ArgumentNullException.ThrowIfNull(configure);
        var options = new LowlineWebOptions();
        configure(options);
        services.AddSingleton(options);
        services.AddSingleton(provider => options.Build(provider.GetService<TimeProvider>()));
        return services;
    }

    /// <summary>Maps the forms under <paramref name="prefix"/>: <c>POST {prefix}/{form}/propose</c> takes
    /// <c>{ "id", "values" }</c> and answers what to show for each open decided field; <c>POST {prefix}/{form}/settle</c>
    /// takes <c>{ "id", "saved", "draft" }</c> — the draft the form element kept while the record was written; no
    /// <c>saved</c> when the host reads its own (<see cref="LowlineWebOptions.Saved"/>) — and answers
    /// <c>{ "id", "settledAt" }</c> once the save is stored and learned; <c>POST {prefix}/{form}/fill</c>, when
    /// the host gave a model (<c>UseModel</c>), takes <c>{ "values", "text" }</c> and answers the model's values as
    /// suggestions from elsewhere; <c>POST {prefix}/{form}/judge</c>, with a model too, takes <c>{ "id", "values" }</c>
    /// and answers, for the decided fields the records could not, what the model judged. A form not defined is 404; input the
    /// engine refuses is 400 with its message. Authorize the returned group as the host requires.</summary>
    public static RouteGroupBuilder MapLowline(this IEndpointRouteBuilder endpoints, string prefix = "/lowline")
    {
        ArgumentNullException.ThrowIfNull(endpoints);
        var group = endpoints.MapGroup(prefix);
        group.MapPost("{form}/propose", context => ProposeAsync(context, Form(context)));
        group.MapPost("{form}/settle", context => SettleAsync(context, Form(context)));
        group.MapPost("{form}/fill", context => FillAsync(context, Form(context)));
        group.MapPost("{form}/judge", context => JudgeAsync(context, Form(context)));
        return group;
    }

    private static async Task ProposeAsync(HttpContext context, string form)
    {
        var (forms, options) = Resolve(context);
        if (!options.Forms.ContainsKey(form))
        {
            context.Response.StatusCode = StatusCodes.Status404NotFound;
            return;
        }

        var request = await ReadAsync(context, WebJson.Default.ProposeRequest).ConfigureAwait(false);
        if (request is null)
        {
            return;
        }

        await RespondAsync(context, async () =>
        {
            var scope = new LowlineScope(form, options.Space(context));
            var shown = await forms.ProposeAsync(
                    scope, request.Id, request.Values, options.Allowed(context, form), context.RequestAborted)
                .ConfigureAwait(false);
            await context.Response.WriteAsJsonAsync(
                    shown, LowlineJson.Default.IReadOnlyListProposal, cancellationToken: context.RequestAborted)
                .ConfigureAwait(false);
        }).ConfigureAwait(false);
    }

    private static async Task SettleAsync(HttpContext context, string form)
    {
        var (forms, options) = Resolve(context);
        if (!options.Forms.ContainsKey(form))
        {
            context.Response.StatusCode = StatusCodes.Status404NotFound;
            return;
        }

        var request = await ReadAsync(context, WebJson.Default.SettleRequest).ConfigureAwait(false);
        if (request is null)
        {
            return;
        }

        IReadOnlyDictionary<string, FieldValue>? saved = request.Saved;
        if (options.Saved is { } stored)
        {
            // The host's own record is what a person settled; values the request carries are not read.
            saved = await stored(context, form, request.Id, context.RequestAborted).ConfigureAwait(false);
            if (saved is null)
            {
                context.Response.StatusCode = StatusCodes.Status404NotFound;
                return;
            }
        }
        else if (saved is null)
        {
            await Results.Problem("The request carries no saved values.", statusCode: StatusCodes.Status400BadRequest)
                .ExecuteAsync(context).ConfigureAwait(false);
            return;
        }

        await RespondAsync(context, async () =>
        {
            var scope = new LowlineScope(form, options.Space(context));
            var draft = request.Draft is { ValueKind: not (JsonValueKind.Null or JsonValueKind.Undefined) } kept
                ? kept.GetRawText()
                : null;
            var settled = await forms.SettleAsync(
                    scope, request.Id, saved, draft, SettledBy.Person, context.RequestAborted)
                .ConfigureAwait(false);
            await context.Response.WriteAsJsonAsync(
                    new SettleResponse(settled.Id, settled.SettledAt), WebJson.Default.SettleResponse,
                    cancellationToken: context.RequestAborted)
                .ConfigureAwait(false);
        }).ConfigureAwait(false);
    }

    private static async Task FillAsync(HttpContext context, string form)
    {
        var (forms, options) = Resolve(context);
        if (!options.Forms.ContainsKey(form) || !forms.CanFill)
        {
            // Filling is on only when the host gave a model.
            context.Response.StatusCode = StatusCodes.Status404NotFound;
            return;
        }

        var request = await ReadAsync(context, WebJson.Default.FillRequest).ConfigureAwait(false);
        if (request is null)
        {
            return;
        }

        await RespondAsync(context, async () =>
        {
            var scope = new LowlineScope(form, options.Space(context));
            var shown = await forms.FillAsync(
                    scope, request.Values, request.Text, options.Allowed(context, form), context.RequestAborted)
                .ConfigureAwait(false);
            await context.Response.WriteAsJsonAsync(
                    shown, LowlineJson.Default.IReadOnlyListProposal, cancellationToken: context.RequestAborted)
                .ConfigureAwait(false);
        }).ConfigureAwait(false);
    }

    private static async Task JudgeAsync(HttpContext context, string form)
    {
        var (forms, options) = Resolve(context);
        if (!options.Forms.ContainsKey(form) || !forms.CanFill)
        {
            // Judging is on only when the host gave a model.
            context.Response.StatusCode = StatusCodes.Status404NotFound;
            return;
        }

        var request = await ReadAsync(context, WebJson.Default.ProposeRequest).ConfigureAwait(false);
        if (request is null)
        {
            return;
        }

        await RespondAsync(context, async () =>
        {
            var scope = new LowlineScope(form, options.Space(context));
            var judged = await forms.JudgeAsync(
                    scope, request.Id, request.Values, options.Allowed(context, form), context.RequestAborted)
                .ConfigureAwait(false);
            await context.Response.WriteAsJsonAsync(
                    judged, LowlineJson.Default.IReadOnlyListProposal, cancellationToken: context.RequestAborted)
                .ConfigureAwait(false);
        }).ConfigureAwait(false);
    }

    private static string Form(HttpContext context) => (string)context.Request.RouteValues["form"]!;

    private static (LowlineForms Forms, LowlineWebOptions Options) Resolve(HttpContext context) =>
        (context.RequestServices.GetRequiredService<LowlineForms>(),
            context.RequestServices.GetRequiredService<LowlineWebOptions>());

    /// <summary>The request body, or <c>null</c> with a 400 written when it does not read.</summary>
    private static async Task<T?> ReadAsync<T>(HttpContext context, System.Text.Json.Serialization.Metadata.JsonTypeInfo<T> type)
        where T : class
    {
        try
        {
            var read = await context.Request.ReadFromJsonAsync(type, context.RequestAborted).ConfigureAwait(false);
            if (read is not null)
            {
                return read;
            }
        }
        catch (JsonException)
        {
        }

        await Results.Problem("The request body does not read.", statusCode: StatusCodes.Status400BadRequest)
            .ExecuteAsync(context).ConfigureAwait(false);
        return null;
    }

    private static async Task RespondAsync(HttpContext context, Func<Task> respond)
    {
        try
        {
            await respond().ConfigureAwait(false);
        }
        catch (ArgumentException refused)
        {
            await Results.Problem(refused.Message, statusCode: StatusCodes.Status400BadRequest)
                .ExecuteAsync(context).ConfigureAwait(false);
        }
    }
}

internal sealed record ProposeRequest(
    [property: JsonPropertyName("id")] string Id,
    [property: JsonPropertyName("values")] Dictionary<string, FieldValue> Values);

internal sealed record SettleRequest(
    [property: JsonPropertyName("id")] string Id,
    [property: JsonPropertyName("saved")] Dictionary<string, FieldValue>? Saved,
    [property: JsonPropertyName("draft")] JsonElement? Draft);

internal sealed record FillRequest(
    [property: JsonPropertyName("values")] Dictionary<string, FieldValue> Values,
    [property: JsonPropertyName("text")] string Text);

internal sealed record SettleResponse(
    [property: JsonPropertyName("id")] string Id,
    [property: JsonPropertyName("settledAt")] DateTimeOffset SettledAt);

[JsonSerializable(typeof(ProposeRequest))]
[JsonSerializable(typeof(SettleRequest))]
[JsonSerializable(typeof(SettleResponse))]
[JsonSerializable(typeof(FillRequest))]
internal sealed partial class WebJson : JsonSerializerContext;
