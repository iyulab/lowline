namespace Lowline;

/// <summary>What a host's model is asked when a form is filled from what a person wrote or showed: the form, the fields
/// it may fill (each with the kind of value it takes and, for a choice field, the values this person may pick), the
/// text, what the person showed (<see cref="Attachments"/>), and the values the record holds already.</summary>
public sealed record LowlineFillRequest(
    string Form,
    IReadOnlyList<FillField> Fields,
    string Text,
    IReadOnlyDictionary<string, FieldValue> Values)
{
    /// <summary>What the person showed rather than wrote — a photo of a nameplate, a scan — for the model to read; empty
    /// when only text was given. The engine does not read, keep or store them.</summary>
    public IReadOnlyList<LowlineAttachment> Attachments { get; init; } = [];
}

/// <summary>Something a person showed rather than wrote, handed to the host's model with a fill request: its media type
/// (<c>image/jpeg</c>, <c>application/pdf</c>, …), its bytes and, if known, its name. It is the model's input and no
/// more — the engine reads none of it, keeps none of it, and does not know what the model makes of it; whatever the model
/// answers is a suggestion from elsewhere, like an answer to text. A host that holds files by reference reads them before
/// it asks.</summary>
public sealed record LowlineAttachment(string MediaType, ReadOnlyMemory<byte> Content, string? Name = null);

/// <summary>What a host's model is asked when the records could not answer a decided field: the form, the field, the
/// values this person may pick for it (<c>null</c> for any), the fields and values the record holds that the judgement
/// should read (<see cref="Proposal.Asks"/>), and all the values the record holds.</summary>
public sealed record LowlineJudgeRequest(
    string Form,
    string Field,
    IReadOnlyList<string>? Choices,
    IReadOnlyList<KeyValuePair<string, string>> Evidence,
    IReadOnlyDictionary<string, FieldValue> Values);

/// <summary>The host's model, filling a form's fields from what a person wrote or showed. The engine calls no model of
/// its own: filling is on only when the host gives one. Whatever the model answers is checked against its field and
/// shown as a suggestion from elsewhere, for the person to take.</summary>
public interface ILowlineModel
{
    /// <summary>The model's value for each field of <see cref="LowlineFillRequest.Fields"/> it can tell from the text;
    /// a field it cannot tell is left out.</summary>
    Task<IReadOnlyDictionary<string, FieldValue>> FillAsync(
        LowlineFillRequest request, CancellationToken cancellationToken = default);

    /// <summary>The model's values for a decided field the records could not answer, best first, each with its
    /// probability and whether the model trusts it — read from <see cref="LowlineJudgeRequest.Evidence"/>. A model
    /// that does not judge answers nothing, as this does unless implemented.</summary>
    Task<IReadOnlyList<JudgedValue>> JudgeAsync(
        LowlineJudgeRequest request, CancellationToken cancellationToken = default) =>
        Task.FromResult<IReadOnlyList<JudgedValue>>([]);
}
