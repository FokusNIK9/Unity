Shader "MainGame/SelectionGlow"
{
    Properties
    {
        _GlowColor ("Glow Color", Color) = (0.05, 1, 0.35, 0.85)
    }
    SubShader
    {
        Tags { "RenderType"="Transparent" "Queue"="Transparent+50" "RenderPipeline"="UniversalPipeline" }
        Pass
        {
            Name "SelectionGlow"
            Cull Front
            ZWrite Off
            Blend SrcAlpha One

            HLSLPROGRAM
            #pragma vertex vert
            #pragma fragment frag
            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Core.hlsl"

            struct Attributes { float4 positionOS : POSITION; };
            struct Varyings { float4 positionHCS : SV_POSITION; };
            CBUFFER_START(UnityPerMaterial)
                half4 _GlowColor;
            CBUFFER_END

            Varyings vert(Attributes input)
            {
                Varyings output;
                output.positionHCS = TransformObjectToHClip(input.positionOS.xyz);
                return output;
            }

            half4 frag(Varyings input) : SV_Target { return _GlowColor; }
            ENDHLSL
        }
    }
}
