namespace Lowline.Host.Tests;

/// <summary>Failures away from any request, kept until the shell takes them.</summary>
public sealed class HostFailuresTests
{
    [Fact]
    public void Hands_over_what_failed_once()
    {
        var failures = new HostFailures();
        failures.Record(new InvalidOperationException("문서/회의록.md"));

        var taken = failures.Take();

        Assert.Equal("System.InvalidOperationException", Assert.Single(taken).Kind);
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
