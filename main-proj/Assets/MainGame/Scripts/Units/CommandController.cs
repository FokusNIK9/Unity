using UnityEngine;
using UnityEngine.AI;
using UnityEngine.InputSystem;

namespace MainGame.Units
{
    public sealed class CommandController : MonoBehaviour
    {
        [SerializeField] private Camera worldCamera;
        [SerializeField] private SelectionController selection;
        [SerializeField] private LayerMask groundMask = ~0;
        public event System.Action<Vector3, int> MoveIssued;
        public void SetCamera(Camera camera) => worldCamera = camera;

        private void Update()
        {
            if (Mouse.current == null || !Mouse.current.rightButton.wasPressedThisFrame || selection == null || selection.Selected.Count == 0) return;
            Ray ray = worldCamera.ScreenPointToRay(Mouse.current.position.ReadValue());
            if (!Physics.Raycast(ray, out RaycastHit hit, 1000f, groundMask)) return;
            Vector3 destination = hit.point;
            if (NavMesh.SamplePosition(hit.point, out NavMeshHit navHit, 3f, NavMesh.AllAreas)) destination = navHit.position;
            int index = 0;
            foreach (UnitView unit in selection.Selected)
            {
                if (unit == null || unit.Movement == null) continue;
                Vector3 offset = index++ == 0 ? Vector3.zero : Quaternion.Euler(0f, index * 137f, 0f) * Vector3.forward * 0.75f;
                unit.Movement.MoveTo(destination + offset);
            }
            MoveIssued?.Invoke(destination, index);
        }
    }
}
