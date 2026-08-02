using UnityEngine;
using UnityEngine.EventSystems;
using UnityEngine.InputSystem.UI;
using MainGame.Units;
using MainGame.UI;
using MainGame.World;

namespace MainGame.Core
{
    public class GameBootstrap : MonoBehaviour
    {
        [SerializeField] private Camera worldCamera;
        [SerializeField] private UnitSpawner unitSpawner;
        [SerializeField] private SelectionController selectionController;
        [SerializeField] private CommandController commandController;
        [SerializeField] private HudController hudController;

        private void Awake()
        {
            worldCamera ??= Camera.main;
            if (worldCamera != null && worldCamera.GetComponent<TopDownCameraController>() == null) worldCamera.gameObject.AddComponent<TopDownCameraController>();
            unitSpawner ??= GetComponent<UnitSpawner>() ?? gameObject.AddComponent<UnitSpawner>();
            selectionController ??= GetComponent<SelectionController>() ?? gameObject.AddComponent<SelectionController>();
            commandController ??= GetComponent<CommandController>() ?? gameObject.AddComponent<CommandController>();
            hudController ??= FindAnyObjectByType<HudController>();
            if (FindAnyObjectByType<EventSystem>() == null)
            {
                GameObject events = new GameObject("EventSystem");
                events.AddComponent<EventSystem>();
                events.AddComponent<InputSystemUIInputModule>();
            }
            if (worldCamera != null)
            {
                selectionController.SendMessage("SetCamera", worldCamera, SendMessageOptions.DontRequireReceiver);
                commandController.SendMessage("SetCamera", worldCamera, SendMessageOptions.DontRequireReceiver);
            }
        }

        private void Start() => unitSpawner.SpawnInitialUnits();
    }
}
