using UnityEngine;

namespace MainGame.Building
{
    [CreateAssetMenu(menuName = "MainGame/Building Definition")]
    public class BuildingDefinition : ScriptableObject
    {
        public string BuildingName;
        public int Cost;
    }
}
