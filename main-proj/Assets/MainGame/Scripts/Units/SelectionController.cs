using System.Collections.Generic;
using UnityEngine;
using UnityEngine.EventSystems;
using UnityEngine.InputSystem;

namespace MainGame.Units
{
    public sealed class SelectionController : MonoBehaviour
    {
        [SerializeField] private Camera worldCamera;
        [SerializeField] private LayerMask unitMask = ~0;
        [SerializeField] private RectTransform selectionBox;
        private readonly List<UnitView> selected = new();
        private Vector2 dragStart;
        private bool dragging;

        public IReadOnlyList<UnitView> Selected => selected;
        public event System.Action<IReadOnlyList<UnitView>> SelectionChanged;
        public void SetCamera(Camera camera) => worldCamera = camera;

        private void Update()
        {
            if (worldCamera == null) worldCamera = Camera.main;
            if (Mouse.current == null || worldCamera == null) return;
            if (Mouse.current.leftButton.wasPressedThisFrame && !IsPointerOverUi()) { dragStart = Mouse.current.position.ReadValue(); dragging = true; }
            if (dragging && Mouse.current.leftButton.isPressed) UpdateBox();
            if (dragging && Mouse.current.leftButton.wasReleasedThisFrame) FinishSelection();
        }

        private void UpdateBox()
        {
            if (selectionBox == null) return;
            selectionBox.gameObject.SetActive(true);
            Vector2 end = Mouse.current.position.ReadValue();
            selectionBox.position = (dragStart + end) * 0.5f;
            selectionBox.sizeDelta = new Vector2(Mathf.Abs(end.x - dragStart.x), Mathf.Abs(end.y - dragStart.y));
        }

        private void FinishSelection()
        {
            dragging = false;
            if (selectionBox != null) selectionBox.gameObject.SetActive(false);
            Vector2 end = Mouse.current.position.ReadValue();
            bool isClick = (end - dragStart).sqrMagnitude < 64f;
            bool additive = Keyboard.current != null && Keyboard.current.leftShiftKey.isPressed;
            if (!additive) ClearInternal();

            if (isClick)
            {
                Ray ray = worldCamera.ScreenPointToRay(end);
                UnitView clickedUnit = FindUnitInRay(ray);
                if (clickedUnit != null)
                {
                    if (additive && selected.Contains(clickedUnit)) RemoveInternal(clickedUnit); else AddInternal(clickedUnit);
                }
            }
            else
            {
                Rect rect = MakeScreenRect(dragStart, end);
                foreach (UnitView unit in FindObjectsByType<UnitView>())
                {
                    Vector3 screen = worldCamera.WorldToScreenPoint(unit.transform.position);
                    if (screen.z > 0f && rect.Contains(screen)) AddInternal(unit);
                }
            }
            SelectionChanged?.Invoke(selected);
        }

        private void AddInternal(UnitView unit) { if (!selected.Contains(unit)) { selected.Add(unit); unit.SetSelected(true); } }
        private void RemoveInternal(UnitView unit) { if (selected.Remove(unit)) unit.SetSelected(false); }
        private void ClearInternal() { foreach (UnitView unit in selected) if (unit != null) unit.SetSelected(false); selected.Clear(); }
        private static Rect MakeScreenRect(Vector2 a, Vector2 b) => Rect.MinMaxRect(Mathf.Min(a.x,b.x), Mathf.Min(a.y,b.y), Mathf.Max(a.x,b.x), Mathf.Max(a.y,b.y));
        private static bool IsPointerOverUi() => EventSystem.current != null && EventSystem.current.IsPointerOverGameObject();

        private UnitView FindUnitInRay(Ray ray)
        {
            RaycastHit[] hits = Physics.RaycastAll(ray, 1000f, unitMask, QueryTriggerInteraction.Ignore);
            System.Array.Sort(hits, (a, b) => a.distance.CompareTo(b.distance));
            foreach (RaycastHit hit in hits)
            {
                UnitView unit = hit.collider.GetComponentInParent<UnitView>();
                if (unit != null) return unit;
            }
            return null;
        }
    }
}
