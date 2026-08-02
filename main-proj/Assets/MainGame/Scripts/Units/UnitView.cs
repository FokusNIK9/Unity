using UnityEngine;

namespace MainGame.Units
{
    public sealed class UnitView : MonoBehaviour
    {
        [SerializeField] private GameObject selectionMarker;
        [SerializeField] private GameObject selectionGlow;

        public UnitMovement Movement { get; private set; }

        private void Awake()
        {
            Movement = GetComponent<UnitMovement>();
            if (selectionMarker != null) selectionMarker.SetActive(false);
            if (selectionGlow != null) selectionGlow.SetActive(false);
        }

        public void RefreshReferences() => Movement = GetComponent<UnitMovement>();


        public void SetSelected(bool selected)
        {
            if (selectionMarker != null) selectionMarker.SetActive(selected);
            if (selectionGlow != null) selectionGlow.SetActive(selected);
        }
    }
}
