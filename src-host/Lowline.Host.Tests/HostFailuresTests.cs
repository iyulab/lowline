using System.Diagnostics;
using System.Runtime.CompilerServices;
using System.Text.Json;

namespace Lowline.Host.Tests;

/// <summary>
/// Failures away from any request, kept until the shell takes them: the exception's type and the
/// methods it passed through — never its message, which can hold a vault path or a value.
/// </summary>
public sealed class HostFailuresTests
{
    [MethodImpl(MethodImplOptions.NoInlining)]
    private static void Throws() => throw new InvalidOperationException("문서/회의록.md — 담당: 장비");

    [Fact]
    public void Names_the_type_and_the_apps_methods_but_not_the_message()
    {
        var failures = new HostFailures();
        try
        {
            Throws();
            throw new UnreachableException();
        }
        catch (InvalidOperationException e)
        {
            failures.Record(e);
        }

        var failure = Assert.Single(failures.Take());

        Assert.Equal("System.InvalidOperationException", failure.Type);
        Assert.Equal("Lowline.Host.Tests.HostFailuresTests.Throws", failure.At);
        Assert.All(failure.Frames, f => Assert.Contains(HostFailures.OwnNamespaces, own => f.StartsWith(own, StringComparison.Ordinal)));
        var json = JsonSerializer.Serialize(failure, JsonSerializerOptions.Web);
        Assert.DoesNotContain("회의록", json);
        Assert.DoesNotContain("장비", json);
    }

    [Fact]
    public void Hands_over_what_failed_once()
    {
        var failures = new HostFailures();
        failures.Record(new InvalidOperationException("문서/회의록.md"));

        var taken = failures.Take();

        Assert.Equal("System.InvalidOperationException", Assert.Single(taken).Type);
        Assert.Empty(failures.Take());
    }

    [Fact]
    public void Keeps_no_more_than_it_can_say_something_new_about()
    {
        var failures = new HostFailures();
        for (var i = 0; i < HostFailures.Capacity + 5; i++) failures.Record(new TimeoutException());

        Assert.Equal(HostFailures.Capacity, failures.Take().Count);
    }
}
