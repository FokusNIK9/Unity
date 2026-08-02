using UnityEngine;
using UnityEngine.UI;
using MainGame.Units;

namespace MainGame.UI
{
    public class HudController : MonoBehaviour
    {
        [SerializeField] private SelectionController selection;
        [SerializeField] private CommandController commands;
        [SerializeField] private Text status;

        private void Awake()
        {
            if (status == null) return;
            if (status.font == null) status.font = Resources.GetBuiltinResource<Font>("LegacyRuntime.ttf");
            status.fontSize = 18;
            status.color = Color.white;
            status.alignment = TextAnchor.UpperLeft;
            status.raycastTarget = false;
        }

        private void Start()
        {
            selection ??= FindAnyObjectByType<SelectionController>();
            commands ??= FindAnyObjectByType<CommandController>();
            if (selection != null) selection.SelectionChanged += OnSelectionChanged;
            if (commands != null) commands.MoveIssued += OnMoveIssued;
            Refresh("Ready");
        }

        private void OnDestroy()
        {
            if (selection != null) selection.SelectionChanged -= OnSelectionChanged;
            if (commands != null) commands.MoveIssued -= OnMoveIssued;
        }

        private void OnSelectionChanged(System.Collections.Generic.IReadOnlyList<UnitView> units) => Refresh($"Selected: {units.Count}");
        private void OnMoveIssued(Vector3 point, int count) => Refresh($"Move issued to {point:F1} ({count} units)");
        private void Refresh(string message)
        {
            if (status != null) status.text = $"RTS TEST HUD\nWood: 500   Stone: 300   Gold: 100\n{message}\nLMB select / Shift add-remove / RMB move";
        }
    }
}
