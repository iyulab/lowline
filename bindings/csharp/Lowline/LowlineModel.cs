namespace Lowline;

/// <summary>What a host's model is asked when a form is filled from what a person wrote or showed: the form, the fields
/// it may fill (each with the kind of value it takes and, for a choice field, the values this person may pick), the
/// text, and the values the record holds already.</summary>
public sealed record LowlineFillRequest(
    string Form,
    IReadOnlyList<FillField> Fields,
    string Text,
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
}
