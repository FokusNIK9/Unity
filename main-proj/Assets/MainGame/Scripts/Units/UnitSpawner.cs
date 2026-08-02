using UnityEngine;

namespace MainGame.Units
{
    public sealed class UnitSpawner : MonoBehaviour
    {
        [SerializeField] private UnitView unitPrefab;
        [SerializeField] private int initialCount = 6;
        [SerializeField] private Vector3 spawnCenter = new Vector3(-3f, 0.5f, 0f);
        [SerializeField] private float spacing = 1.25f;

        public void SpawnInitialUnits()
        {
            Debug.Log($"UnitSpawner: spawning {Mathf.Max(0, initialCount)} test units (prefab assigned: {unitPrefab != null})");
            for (int i = 0; i < Mathf.Max(0, initialCount); i++)
            {
                int row = i / 3;
                int column = i % 3;
                UnitView unit;
                if (unitPrefab != null) unit = Instantiate(unitPrefab, spawnCenter + new Vector3(column * spacing, 0f, row * spacing), Quaternion.identity, transform);
                else
                {
                    GameObject go = GameObject.CreatePrimitive(PrimitiveType.Capsule);
                    go.name = $"TestUnit_{i + 1}";
                    go.transform.SetParent(transform);
                    go.transform.position = spawnCenter + new Vector3(column * spacing, 0f, row * spacing);
                    unit = go.AddComponent<UnitView>();
                    go.AddComponent<UnitMovement>();
                    unit.RefreshReferences();
                }
            }
        }
    }
}
