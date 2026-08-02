using UnityEngine;
using UnityEngine.AI;

namespace MainGame.Units
{
    public sealed class UnitMovement : MonoBehaviour
    {
        [SerializeField] private float moveSpeed = 4f;
        private NavMeshAgent agent;
        private Vector3 fallbackTarget;
        private bool usingFallback;

        private void Awake()
        {
            agent = GetComponent<NavMeshAgent>();
            if (agent == null) return;
            agent.speed = moveSpeed;
            agent.angularSpeed = 720f;
            agent.acceleration = 24f;
            agent.stoppingDistance = 0.15f;
        }

        public void MoveTo(Vector3 destination)
        {
            if (agent == null && NavMesh.SamplePosition(transform.position, out _, 1.5f, NavMesh.AllAreas))
            {
                agent = gameObject.AddComponent<NavMeshAgent>();
                agent.speed = moveSpeed;
                agent.angularSpeed = 720f;
                agent.acceleration = 24f;
                agent.stoppingDistance = 0.15f;
            }
            if (agent != null && agent.isOnNavMesh)
            {
                usingFallback = false;
                agent.isStopped = false;
                agent.SetDestination(destination);
                return;
            }

            usingFallback = true;
            fallbackTarget = destination;
        }

        private void Update()
        {
            if (!usingFallback) return;
            transform.position = Vector3.MoveTowards(transform.position, fallbackTarget, moveSpeed * Time.deltaTime);
            Vector3 delta = fallbackTarget - transform.position;
            if (delta.sqrMagnitude > 0.01f) transform.forward = Vector3.Lerp(transform.forward, delta.normalized, 12f * Time.deltaTime);
            if (delta.sqrMagnitude < 0.01f) usingFallback = false;
        }
    }
}
