using System.Diagnostics;
using Microsoft.AspNetCore.Diagnostics;

namespace Lowline.Host;

/// <summary>A failed request, as the shell hears it: the exception's type and the methods it passed through.</summary>
public sealed record HostFailure(string Kind, IReadOnlyList<string> Frames);

/// <summary>
/// What the sidecar says when a request fails. Never the exception's message: it can hold a vault
/// path, a template name or a value, and the shell may report this failure off the device.
/// </summary>
public static class HostErrors
{
    /// <summary>Enough of a stack to tell one failure from another.</summary>
    private const int MaxFrames = 20;

    public static HostFailure Of(Exception exception) => new(
        exception.GetType().FullName ?? exception.GetType().Name,
        [.. new StackTrace(exception).GetFrames()
            .Select(frame => frame.GetMethod())
            .OfType<System.Reflection.MethodBase>()
            .Where(method => !IsAwaitPlumbing(method))
            .Select(method => $"{method.DeclaringType?.FullName}.{method.Name}")
            .Take(MaxFrames)]);

    /// <summary>The frames an <c>await</c> adds between two methods of the app: they say nothing about the failure.</summary>
    private static bool IsAwaitPlumbing(System.Reflection.MethodBase method) =>
        method.DeclaringType?.Namespace is "System.Runtime.CompilerServices" or "System.Runtime.ExceptionServices";

    /// <summary>Answers a failed request with 500 and its <see cref="HostFailure"/>.</summary>
    public static void Answer(IApplicationBuilder app) => app.Run(async context =>
    {
        var exception = context.Features.Get<IExceptionHandlerFeature>()?.Error;
        context.Response.StatusCode = StatusCodes.Status500InternalServerError;
        if (exception is not null) await context.Response.WriteAsJsonAsync(Of(exception));
    });
}
