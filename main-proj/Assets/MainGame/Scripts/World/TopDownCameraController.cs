using UnityEngine;
using UnityEngine.InputSystem;

namespace MainGame.World
{
    public sealed class TopDownCameraController : MonoBehaviour
    {
        [SerializeField] private float panSpeed = 12f;
        [SerializeField] private float zoomSpeed = 4f;
        [SerializeField] private float minOrthographicSize = 5f;
        [SerializeField] private float maxOrthographicSize = 30f;

        private Camera targetCamera;

        private void Awake() => targetCamera = GetComponent<Camera>();

        private void Update()
        {
            if (targetCamera == null || Keyboard.current == null) return;
            Vector2 input = Vector2.zero;
            if (Keyboard.current.wKey.isPressed || Keyboard.current.upArrowKey.isPressed) input.y += 1f;
            if (Keyboard.current.sKey.isPressed || Keyboard.current.downArrowKey.isPressed) input.y -= 1f;
            if (Keyboard.current.dKey.isPressed || Keyboard.current.rightArrowKey.isPressed) input.x += 1f;
            if (Keyboard.current.aKey.isPressed || Keyboard.current.leftArrowKey.isPressed) input.x -= 1f;
            transform.position += new Vector3(input.x, 0f, input.y).normalized * panSpeed * Time.deltaTime;
            float scroll = Mouse.current != null ? Mouse.current.scroll.ReadValue().y : 0f;
            targetCamera.orthographicSize = Mathf.Clamp(targetCamera.orthographicSize - scroll * zoomSpeed * 0.01f, minOrthographicSize, maxOrthographicSize);
        }
    }
}
