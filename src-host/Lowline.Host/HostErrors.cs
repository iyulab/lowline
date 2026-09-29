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

/// <summary>
/// Failures away from any request — work the sidecar does on its own — kept until the shell takes
/// them, since the sidecar never sends anything itself.
/// </summary>
public sealed class HostFailures
{
    /// <summary>Past this many, more of the same would say nothing new.</summary>
    public const int Capacity = 20;

    private readonly Lock _lock = new();
    private readonly List<HostFailure> _kept = [];

    public void Record(Exception exception)
    {
        lock (_lock)
        {
            if (_kept.Count < Capacity) _kept.Add(HostErrors.Of(exception));
        }
    }

    /// <summary>What failed since the last time, which is then forgotten.</summary>
    public IReadOnlyList<HostFailure> Take()
    {
        lock (_lock)
        {
            var taken = _kept.ToList();
            _kept.Clear();
            return taken;
        }
    }
}
